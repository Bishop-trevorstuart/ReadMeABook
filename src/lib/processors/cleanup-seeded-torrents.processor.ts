/**
 * Component: Cleanup Seeded Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Cleans up torrents that have met their seeding requirements
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';

export interface CleanupSeededTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processCleanupSeededTorrents(payload: CleanupSeededTorrentsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'CleanupSeededTorrents');

  logger.info('Starting cleanup job for seeded torrents...');

  try {
    // Get indexer configuration with per-indexer seeding times
    const { getConfigService } = await import('../services/config.service');
    const configService = getConfigService();
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    if (!indexersConfigStr) {
      logger.warn('No indexer configuration found, skipping');
      return {
        success: false,
        message: 'No indexer configuration',
        skipped: true,
      };
    }

    const indexersConfig = JSON.parse(indexersConfigStr);

    // Create a map of indexer name to config for quick lookup
    const indexerConfigMap = new Map<string, any>();
    for (const indexer of indexersConfig) {
      indexerConfigMap.set(indexer.name, indexer);
    }

    logger.info(`Loaded configuration for ${indexerConfigMap.size} indexers`);

    // Find all completed requests + soft-deleted requests (orphaned downloads)
    // IMPORTANT: Only cleanup requests that are truly complete and not being actively processed
    // NOTE: Multiple requests can share the same torrent hash (e.g., re-requesting same audiobook)
    // Before deleting torrent, we check if other active requests are using it
    const completedRequests = await prisma.request.findMany({
      where: {
        OR: [
          // Active requests that are fully available (scanned by Plex/ABS)
          {
            status: 'available',
            deletedAt: null,
          },
          // Soft-deleted requests (orphaned downloads)
          // We'll check if torrent is shared with active requests before deletion
          {
            deletedAt: { not: null },
          },
        ],
      },
      include: {
        downloadHistory: {
          where: {
            selected: true,
            downloadStatus: 'completed',
          },
          orderBy: { completedAt: 'desc' },
          take: 1,
        },
      },
      take: 100, // Limit to 100 requests per run
    });

    logger.info(`Found ${completedRequests.length} requests to check (status: 'available' or soft-deleted)`);

    let cleaned = 0;
    let skipped = 0;
    let noConfig = 0;

    for (const request of completedRequests) {
      try {
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory || !downloadHistory.indexerName) {
          continue;
        }

        // Skip SABnzbd downloads - Usenet doesn't have seeding concept
        if (downloadHistory.nzbId && !downloadHistory.torrentHash) {
          // For soft-deleted SABnzbd requests, hard delete immediately (no seeding needed)
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned SABnzbd request ${request.id}`);
          }
          continue;
        }

        // Only process torrent downloads
        if (!downloadHistory.torrentHash) {
          continue;
        }

        // Get the indexer name from download history
        const indexerName = downloadHistory.indexerName;

        // Find matching indexer configuration by name
        const seedingConfig = indexerConfigMap.get(indexerName);

        // If no config found or seeding time is 0 (unlimited)
        if (!seedingConfig || seedingConfig.seedingTimeMinutes === 0) {
          // For soft-deleted requests with unlimited seeding, hard delete immediately
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned request ${request.id} with unlimited seeding`);
          }
          noConfig++;
          continue;
        }

        const seedingTimeSeconds = seedingConfig.seedingTimeMinutes * 60;

        // Get torrent info from qBittorrent to check seeding time
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();

        let torrent;
        try {
          torrent = await qbt.getTorrent(downloadHistory.torrentHash);
        } catch (error) {
          // Torrent might already be deleted, skip
          continue;
        }

        // Check if seeding time requirement is met
        const actualSeedingTime = torrent.seeding_time || 0;
        const hasMetRequirement = actualSeedingTime >= seedingTimeSeconds;

        if (!hasMetRequirement) {
          const remaining = Math.ceil((seedingTimeSeconds - actualSeedingTime) / 60);
          skipped++;
          continue;
        }

        logger.info(`Torrent ${torrent.name} (${indexerName}) has met seeding requirement (${Math.floor(actualSeedingTime / 60)}/${seedingConfig.seedingTimeMinutes} minutes)`);

        // CRITICAL: Check if any other active (non-deleted) request is using this same torrent hash
        // This prevents deleting shared torrents when user re-requests the same audiobook
        const otherActiveRequests = await prisma.request.findMany({
          where: {
            id: { not: request.id }, // Exclude current request
            deletedAt: null, // Only check active requests
            downloadHistory: {
              some: {
                torrentHash: downloadHistory.torrentHash,
                selected: true,
              },
            },
          },
          select: { id: true, status: true },
        });

        if (otherActiveRequests.length > 0) {
          logger.info(`Skipping torrent deletion - ${otherActiveRequests.length} other active request(s) still using this torrent (IDs: ${otherActiveRequests.map(r => r.id).join(', ')})`);

          // If this is a soft-deleted request, hard delete it but DON'T delete the torrent
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned request ${request.id} (kept shared torrent for active requests)`);
          }

          skipped++;
          continue;
        }

        // Safe to delete - no other active requests using this torrent
        await qbt.deleteTorrent(downloadHistory.torrentHash, true); // true = delete files

        // If this is a soft-deleted request (orphaned download), hard delete it now
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned request ${request.id} after torrent cleanup`);
        } else {
          logger.info(`Deleted torrent and files for active request ${request.id}`);
        }

        cleaned++;
      } catch (error) {
        logger.error(`Failed to cleanup request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    logger.info(`Cleanup complete: ${cleaned} torrents cleaned, ${skipped} still seeding, ${noConfig} unlimited`);

    return {
      success: true,
      message: 'Cleanup seeded torrents completed',
      totalChecked: completedRequests.length,
      cleaned,
      skipped,
      unlimited: noConfig,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
