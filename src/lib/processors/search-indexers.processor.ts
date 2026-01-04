/**
 * Component: Search Indexers Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { SearchIndexersPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getProwlarrService } from '../integrations/prowlarr.service';
import { getRankingAlgorithm } from '../utils/ranking-algorithm';
import { createJobLogger } from '../utils/job-logger';

/**
 * Process search indexers job
 * Searches configured indexers for audiobook torrents
 */
export async function processSearchIndexers(payload: SearchIndexersPayload): Promise<any> {
  const { requestId, audiobook, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'SearchIndexers') : null;

  await logger?.info(`Processing request ${requestId} for "${audiobook.title}"`);

  try {
    // Update request status to searching
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'searching',
        searchAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // Get enabled indexers from configuration
    const { getConfigService } = await import('../services/config.service');
    const configService = getConfigService();
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    if (!indexersConfigStr) {
      throw new Error('No indexers configured. Please configure indexers in settings.');
    }

    const indexersConfig = JSON.parse(indexersConfigStr);
    const enabledIndexerIds = indexersConfig.map((indexer: any) => indexer.id);

    if (enabledIndexerIds.length === 0) {
      throw new Error('No indexers enabled. Please enable at least one indexer in settings.');
    }

    await logger?.info(`Searching ${enabledIndexerIds.length} enabled indexers`);

    // Get Prowlarr service
    const prowlarr = await getProwlarrService();

    // Build search query (title only - cast wide net, let ranking filter)
    const searchQuery = audiobook.title;

    await logger?.info(`Searching for: "${searchQuery}"`);

    // Search indexers - ONLY enabled ones
    const searchResults = await prowlarr.search(searchQuery, {
      category: 3030, // Audiobooks
      minSeeders: 1, // Only torrents with at least 1 seeder
      maxResults: 100, // Increased limit for broader search
      indexerIds: enabledIndexerIds, // Filter by enabled indexers
    });

    await logger?.info(`Found ${searchResults.length} raw results`);

    if (searchResults.length === 0) {
      // No results found - queue for re-search instead of failing
      await logger?.warn(`No torrents found for request ${requestId}, marking as awaiting_search`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'No torrents found. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No torrents found, queued for re-search',
        requestId,
      };
    }

    // Get ranking algorithm
    const ranker = getRankingAlgorithm();

    // Rank results
    const rankedResults = ranker.rankTorrents(searchResults, {
      title: audiobook.title,
      author: audiobook.author,
      durationMinutes: undefined, // We don't have duration from Audible
    });

    // Filter out results below minimum score threshold (50/100)
    const filteredResults = rankedResults.filter(result => result.score >= 50);

    await logger?.info(`Ranked ${rankedResults.length} results, ${filteredResults.length} above threshold (50/100)`);

    if (filteredResults.length === 0) {
      // No quality results found - queue for re-search instead of failing
      await logger?.warn(`No quality matches found for request ${requestId} (all below 50/100), marking as awaiting_search`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'No quality matches found. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No quality matches found, queued for re-search',
        requestId,
      };
    }

    // Select best result
    const bestResult = filteredResults[0];

    // Log top 3 results with detailed breakdown
    const top3 = filteredResults.slice(0, 3);
    await logger?.info(`==================== RANKING DEBUG ====================`);
    await logger?.info(`Requested Title: "${audiobook.title}"`);
    await logger?.info(`Requested Author: "${audiobook.author}"`);
    await logger?.info(`Top ${top3.length} results (out of ${filteredResults.length} above threshold):`);
    await logger?.info(`--------------------------------------------------------`);
    for (let i = 0; i < top3.length; i++) {
      const result = top3[i];
      await logger?.info(`${i + 1}. "${result.title}"`);
      await logger?.info(`   Indexer: ${result.indexer}`);
      await logger?.info(`   Total: ${result.score.toFixed(1)}/100 | Match: ${result.breakdown.matchScore.toFixed(1)}/50 | Format: ${result.breakdown.formatScore.toFixed(1)}/25 | Seeders: ${result.breakdown.seederScore.toFixed(1)}/15 | Size: ${result.breakdown.sizeScore.toFixed(1)}/10`);
      if (result.breakdown.notes.length > 0) {
        await logger?.info(`   Notes: ${result.breakdown.notes.join(', ')}`);
      }
      if (i < top3.length - 1) {
        await logger?.info(`--------------------------------------------------------`);
      }
    }
    await logger?.info(`========================================================`);
    await logger?.info(`Selected best result: ${bestResult.title} (score: ${bestResult.score.toFixed(1)}/100)`);

    // Trigger download job with best result
    const jobQueue = getJobQueueService();
    await jobQueue.addDownloadJob(requestId, {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
    }, bestResult);

    return {
      success: true,
      message: `Found ${filteredResults.length} quality matches, selected best torrent`,
      requestId,
      resultsCount: filteredResults.length,
      selectedTorrent: {
        title: bestResult.title,
        score: bestResult.score,
        seeders: bestResult.seeders,
        format: bestResult.format,
      },
    };
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during search',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
