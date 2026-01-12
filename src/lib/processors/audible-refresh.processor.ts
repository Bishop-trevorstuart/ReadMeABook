/**
 * Component: Audible Refresh Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Fetches popular and new release audiobooks from Audible and caches them
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';

export interface AudibleRefreshPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processAudibleRefresh(payload: AudibleRefreshPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'AudibleRefresh');

  logger.info('Starting Audible data refresh...');

  const { getAudibleService } = await import('../integrations/audible.service');
  const { getThumbnailCacheService } = await import('../services/thumbnail-cache.service');
  const audibleService = getAudibleService();
  const thumbnailCache = getThumbnailCacheService();

  try {
    // Clear previous popular/new-release flags for fresh data
    await prisma.audibleCache.updateMany({
      where: {
        OR: [
          { isPopular: true },
          { isNewRelease: true },
        ],
      },
      data: {
        isPopular: false,
        isNewRelease: false,
        popularRank: null,
        newReleaseRank: null,
      },
    });
    logger.info('Cleared previous popular/new-release flags in audible_cache');

    // Fetch popular and new releases - 200 items each
    const popular = await audibleService.getPopularAudiobooks(200);
    const newReleases = await audibleService.getNewReleases(200);

    logger.info(`Fetched ${popular.length} popular, ${newReleases.length} new releases from Audible`);

    // Persist to audible_cache
    let popularSaved = 0;
    let newReleasesSaved = 0;
    const syncTime = new Date();

    for (let i = 0; i < popular.length; i++) {
      const audiobook = popular[i];
      try {
        // Cache thumbnail if coverArtUrl exists
        let cachedCoverPath: string | null = null;
        if (audiobook.coverArtUrl) {
          cachedCoverPath = await thumbnailCache.cacheThumbnail(audiobook.asin, audiobook.coverArtUrl);
        }

        await prisma.audibleCache.upsert({
          where: { asin: audiobook.asin },
          create: {
            asin: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isPopular: true,
            popularRank: i + 1,
            lastSyncedAt: syncTime,
          },
          update: {
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isPopular: true,
            popularRank: i + 1,
            lastSyncedAt: syncTime,
          },
        });

        popularSaved++;
      } catch (error) {
        logger.error(`Failed to save popular audiobook ${audiobook.title}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    for (let i = 0; i < newReleases.length; i++) {
      const audiobook = newReleases[i];
      try {
        // Cache thumbnail if coverArtUrl exists
        let cachedCoverPath: string | null = null;
        if (audiobook.coverArtUrl) {
          cachedCoverPath = await thumbnailCache.cacheThumbnail(audiobook.asin, audiobook.coverArtUrl);
        }

        await prisma.audibleCache.upsert({
          where: { asin: audiobook.asin },
          create: {
            asin: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isNewRelease: true,
            newReleaseRank: i + 1,
            lastSyncedAt: syncTime,
          },
          update: {
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isNewRelease: true,
            newReleaseRank: i + 1,
            lastSyncedAt: syncTime,
          },
        });

        newReleasesSaved++;
      } catch (error) {
        logger.error(`Failed to save new release ${audiobook.title}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    logger.info(`Saved ${popularSaved} popular and ${newReleasesSaved} new releases to audible_cache`);

    // Cleanup unused thumbnails
    logger.info('Cleaning up unused thumbnails...');
    const allActiveAsins = await prisma.audibleCache.findMany({
      select: { asin: true },
    });
    const activeAsinSet = new Set(allActiveAsins.map(item => item.asin));
    const deletedCount = await thumbnailCache.cleanupUnusedThumbnails(activeAsinSet);
    logger.info(`Cleanup complete: ${deletedCount} unused thumbnails removed`);

    return {
      success: true,
      message: 'Audible refresh completed',
      popularSaved,
      newReleasesSaved,
      thumbnailsDeleted: deletedCount,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
