/**
 * Component: Search Indexers Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { SearchIndexersPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getProwlarrService } from '../integrations/prowlarr.service';
import { getRankingAlgorithm } from '../utils/ranking-algorithm';
import { RMABLogger } from '../utils/logger';

/**
 * Process search indexers job
 * Searches configured indexers for audiobook torrents
 */
export async function processSearchIndexers(payload: SearchIndexersPayload): Promise<any> {
  const { requestId, audiobook, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'SearchIndexers');

  logger.info(`Processing request ${requestId} for "${audiobook.title}"`);

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

    // Build indexer priorities map (indexerId -> priority 1-25, default 10)
    const indexerPriorities = new Map<number, number>(
      indexersConfig.map((indexer: any) => [indexer.id, indexer.priority ?? 10])
    );

    // Get flag configurations
    const flagConfigStr = await configService.get('indexer_flag_config');
    const flagConfigs = flagConfigStr ? JSON.parse(flagConfigStr) : [];

    logger.info(`Searching ${enabledIndexerIds.length} enabled indexers`);

    // Get Prowlarr service
    const prowlarr = await getProwlarrService();

    // Build search query (title only - cast wide net, let ranking filter)
    const searchQuery = audiobook.title;

    logger.info(`Searching for: "${searchQuery}"`);

    // Search indexers - ONLY enabled ones
    const searchResults = await prowlarr.search(searchQuery, {
      category: 3030, // Audiobooks
      minSeeders: 1, // Only torrents with at least 1 seeder
      maxResults: 100, // Increased limit for broader search
      indexerIds: enabledIndexerIds, // Filter by enabled indexers
    });

    logger.info(`Found ${searchResults.length} raw results`);

    if (searchResults.length === 0) {
      // No results found - queue for re-search instead of failing
      logger.warn(`No torrents found for request ${requestId}, marking as awaiting_search`);

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

    // Rank results with indexer priorities and flag configs
    const rankedResults = ranker.rankTorrents(searchResults, {
      title: audiobook.title,
      author: audiobook.author,
    }, indexerPriorities, flagConfigs);

    // Dual threshold filtering:
    // 1. Base score must be >= 50 (quality minimum)
    // 2. Final score must be >= 50 (not disqualified by negative bonuses)
    const filteredResults = rankedResults.filter(result =>
      result.score >= 50 && result.finalScore >= 50
    );

    const disqualifiedByNegativeBonus = rankedResults.filter(result =>
      result.score >= 50 && result.finalScore < 50
    ).length;

    logger.info(`Ranked ${rankedResults.length} results, ${filteredResults.length} above threshold (50/100 base + final)`);
    if (disqualifiedByNegativeBonus > 0) {
      logger.info(`${disqualifiedByNegativeBonus} torrents disqualified by negative flag bonuses`);
    }

    if (filteredResults.length === 0) {
      // No quality results found - queue for re-search instead of failing
      logger.warn(`No quality matches found for request ${requestId} (all below 50/100), marking as awaiting_search`);

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
    logger.info(`==================== RANKING DEBUG ====================`);
    logger.info(`Requested Title: "${audiobook.title}"`);
    logger.info(`Requested Author: "${audiobook.author}"`);
    logger.info(`Top ${top3.length} results (out of ${filteredResults.length} above threshold):`);
    logger.info(`--------------------------------------------------------`);
    for (let i = 0; i < top3.length; i++) {
      const result = top3[i];
      logger.info(`${i + 1}. "${result.title}"`);
      logger.info(`   Indexer: ${result.indexer}${result.indexerId ? ` (ID: ${result.indexerId})` : ''}`);
      logger.info(``);
      logger.info(`   Base Score: ${result.score.toFixed(1)}/100`);
      logger.info(`   - Title/Author Match: ${result.breakdown.matchScore.toFixed(1)}/60`);
      logger.info(`   - Format Quality: ${result.breakdown.formatScore.toFixed(1)}/25 (${result.format || 'unknown'})`);
      logger.info(`   - Seeder Count: ${result.breakdown.seederScore.toFixed(1)}/15 (${result.seeders !== undefined ? result.seeders + ' seeders' : 'N/A for Usenet'})`);
      logger.info(``);
      logger.info(`   Bonus Points: +${result.bonusPoints.toFixed(1)}`);
      if (result.bonusModifiers.length > 0) {
        for (const mod of result.bonusModifiers) {
          logger.info(`   - ${mod.reason}: +${mod.points.toFixed(1)}`);
        }
      }
      logger.info(``);
      logger.info(`   Final Score: ${result.finalScore.toFixed(1)}`);
      if (result.breakdown.notes.length > 0) {
        logger.info(`   Notes: ${result.breakdown.notes.join(', ')}`);
      }
      if (i < top3.length - 1) {
        logger.info(`--------------------------------------------------------`);
      }
    }
    logger.info(`========================================================`);
    logger.info(`Selected best result: ${bestResult.title} (final score: ${bestResult.finalScore.toFixed(1)})`);

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
        seeders: bestResult.seeders || 0,
        format: bestResult.format,
      },
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

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
