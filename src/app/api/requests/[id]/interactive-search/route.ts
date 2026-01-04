/**
 * Component: Interactive Search API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';

/**
 * POST /api/requests/[id]/interactive-search
 * Search for torrents and return results for user selection
 * Body (optional): { customTitle?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;

      // Parse optional request body
      let customTitle: string | undefined;
      try {
        const body = await req.json();
        customTitle = body.customTitle;
      } catch (e) {
        // No body or invalid JSON - that's okay, customTitle will be undefined
      }

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      // Get enabled indexers from configuration
      const { getConfigService } = await import('@/lib/services/config.service');
      const configService = getConfigService();
      const indexersConfigStr = await configService.get('prowlarr_indexers');

      if (!indexersConfigStr) {
        return NextResponse.json(
          { error: 'ConfigError', message: 'No indexers configured. Please configure indexers in settings.' },
          { status: 400 }
        );
      }

      const indexersConfig = JSON.parse(indexersConfigStr);
      const enabledIndexerIds = indexersConfig.map((indexer: any) => indexer.id);

      if (enabledIndexerIds.length === 0) {
        return NextResponse.json(
          { error: 'ConfigError', message: 'No indexers enabled. Please enable at least one indexer in settings.' },
          { status: 400 }
        );
      }

      // Search Prowlarr for torrents - ONLY enabled indexers
      const prowlarr = await getProwlarrService();
      // Use custom title if provided, otherwise use audiobook's title
      const searchQuery = customTitle || requestRecord.audiobook.title;

      console.log(`[InteractiveSearch] Searching ${enabledIndexerIds.length} enabled indexers for: ${searchQuery}`);
      if (customTitle) {
        console.log(`[InteractiveSearch] Using custom search title (original: "${requestRecord.audiobook.title}")`);
      }

      const results = await prowlarr.search(searchQuery, {
        indexerIds: enabledIndexerIds,
        maxResults: 100, // Increased limit for broader search
      });

      console.log(`[InteractiveSearch] Found ${results.length} raw results for request ${id}`);

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          results: [],
          message: 'No torrents found',
        });
      }

      // Rank torrents using the ranking algorithm
      // Always use the audiobook's title/author for ranking (not custom search query)
      const rankedResults = rankTorrents(results, {
        title: requestRecord.audiobook.title,
        author: requestRecord.audiobook.author,
      });

      // Filter out results below minimum score threshold (50/100)
      const filteredResults = rankedResults.filter(result => result.score >= 50);

      console.log(`[InteractiveSearch] Ranked ${rankedResults.length} results, ${filteredResults.length} above threshold (50/100)`);

      // Log top 3 results with detailed score breakdown for debugging
      const top3 = filteredResults.slice(0, 3);
      if (top3.length > 0) {
        console.log(`[InteractiveSearch] ==================== RANKING DEBUG ====================`);
        console.log(`[InteractiveSearch] Search Query: "${searchQuery}"`);
        console.log(`[InteractiveSearch] Requested Title (for ranking): "${requestRecord.audiobook.title}"`);
        console.log(`[InteractiveSearch] Requested Author (for ranking): "${requestRecord.audiobook.author}"`);
        console.log(`[InteractiveSearch] Top ${top3.length} results (out of ${filteredResults.length} above threshold):`);
        console.log(`[InteractiveSearch] --------------------------------------------------------`);
        top3.forEach((result, index) => {
          console.log(`[InteractiveSearch] ${index + 1}. "${result.title}"`);
          console.log(`[InteractiveSearch]    Indexer: ${result.indexer}`);
          console.log(`[InteractiveSearch]    Total Score: ${result.score.toFixed(1)}/100`);
          console.log(`[InteractiveSearch]    - Title/Author Match: ${result.breakdown.matchScore.toFixed(1)}/50`);
          console.log(`[InteractiveSearch]    - Format Quality: ${result.breakdown.formatScore.toFixed(1)}/25 (${result.format || 'unknown'})`);
          console.log(`[InteractiveSearch]    - Seeder Count: ${result.breakdown.seederScore.toFixed(1)}/15 (${result.seeders} seeders)`);
          console.log(`[InteractiveSearch]    - Size Score: ${result.breakdown.sizeScore.toFixed(1)}/10 (${(result.size / (1024 ** 3)).toFixed(2)} GB)`);
          if (result.breakdown.notes.length > 0) {
            console.log(`[InteractiveSearch]    Notes: ${result.breakdown.notes.join(', ')}`);
          }
          if (index < top3.length - 1) {
            console.log(`[InteractiveSearch] --------------------------------------------------------`);
          }
        });
        console.log(`[InteractiveSearch] ========================================================`);
      }

      // Add rank position to each result
      const resultsWithRank = filteredResults.map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

      return NextResponse.json({
        success: true,
        results: resultsWithRank,
        message: filteredResults.length > 0
          ? `Found ${filteredResults.length} quality matches`
          : 'No quality matches found',
      });
    } catch (error) {
      console.error('Failed to perform interactive search:', error);
      return NextResponse.json(
        {
          error: 'SearchError',
          message: error instanceof Error ? error.message : 'Failed to search for torrents',
        },
        { status: 500 }
      );
    }
  });
}
