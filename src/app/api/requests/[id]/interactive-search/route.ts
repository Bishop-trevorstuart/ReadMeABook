/**
 * Component: Interactive Search API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.InteractiveSearch');

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

      // Build indexer priorities map (indexerId -> priority 1-25, default 10)
      const indexerPriorities = new Map<number, number>(
        indexersConfig.map((indexer: any) => [indexer.id, indexer.priority ?? 10])
      );

      // Get flag configurations
      const flagConfigStr = await configService.get('indexer_flag_config');
      const flagConfigs = flagConfigStr ? JSON.parse(flagConfigStr) : [];

      // Search Prowlarr for torrents - ONLY enabled indexers
      const prowlarr = await getProwlarrService();
      // Use custom title if provided, otherwise use audiobook's title
      const searchQuery = customTitle || requestRecord.audiobook.title;

      logger.info(`Searching ${enabledIndexerIds.length} enabled indexers`, { searchQuery });
      if (customTitle) {
        logger.debug('Using custom search title', { customTitle, originalTitle: requestRecord.audiobook.title });
      }

      const results = await prowlarr.search(searchQuery, {
        indexerIds: enabledIndexerIds,
        maxResults: 100, // Increased limit for broader search
      });

      logger.debug(`Found ${results.length} raw results`, { requestId: id });

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          results: [],
          message: 'No torrents found',
        });
      }

      // Rank torrents using the ranking algorithm with indexer priorities and flag configs
      // Always use the audiobook's title/author for ranking (not custom search query)
      const rankedResults = rankTorrents(results, {
        title: requestRecord.audiobook.title,
        author: requestRecord.audiobook.author,
      }, indexerPriorities, flagConfigs);

      // No threshold filtering for interactive search - show all results
      // User can see scores and make their own decision
      logger.debug(`Ranked ${rankedResults.length} results (no threshold filter - user decides)`);

      // Log top 3 results with detailed score breakdown for debugging
      const top3 = rankedResults.slice(0, 3);
      if (top3.length > 0) {
        logger.debug('==================== RANKING DEBUG ====================');
        logger.debug('Search parameters', { searchQuery, requestedTitle: requestRecord.audiobook.title, requestedAuthor: requestRecord.audiobook.author });
        logger.debug(`Top ${top3.length} results (out of ${rankedResults.length} total)`);
        logger.debug('--------------------------------------------------------');
        top3.forEach((result, index) => {
          logger.debug(`${index + 1}. "${result.title}"`, {
            indexer: result.indexer,
            indexerId: result.indexerId,
            baseScore: `${result.score.toFixed(1)}/100`,
            matchScore: `${result.breakdown.matchScore.toFixed(1)}/60`,
            formatScore: `${result.breakdown.formatScore.toFixed(1)}/25 (${result.format || 'unknown'})`,
            seederScore: `${result.breakdown.seederScore.toFixed(1)}/15 (${result.seeders} seeders)`,
            bonusPoints: `+${result.bonusPoints.toFixed(1)}`,
            bonusModifiers: result.bonusModifiers.map(mod => `${mod.reason}: +${mod.points.toFixed(1)}`),
            finalScore: result.finalScore.toFixed(1),
            notes: result.breakdown.notes,
          });
        });
        logger.debug('========================================================');
      }

      // Add rank position to each result
      const resultsWithRank = rankedResults.map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

      return NextResponse.json({
        success: true,
        results: resultsWithRank,
        message: rankedResults.length > 0
          ? `Found ${rankedResults.length} results`
          : 'No results found',
      });
    } catch (error) {
      logger.error('Failed to perform interactive search', { error: error instanceof Error ? error.message : String(error) });
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
