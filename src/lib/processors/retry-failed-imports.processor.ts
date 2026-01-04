/**
 * Component: Retry Failed Imports Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries file organization for requests that are awaiting import
 */

import { prisma } from '../db';
import { createJobLogger } from '../utils/job-logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getConfigService } from '../services/config.service';
import { PathMapper } from '../utils/path-mapper';

export interface RetryFailedImportsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processRetryFailedImports(payload: RetryFailedImportsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = jobId ? createJobLogger(jobId, 'RetryFailedImports') : null;

  await logger?.info('Starting retry job for requests awaiting import...');

  try {
    // Load path mapping configuration once
    const configService = getConfigService();
    const pathMappingConfig = await configService.getMany([
      'download_client_remote_path_mapping_enabled',
      'download_client_remote_path',
      'download_client_local_path',
    ]);

    const mappingConfig = {
      enabled: pathMappingConfig.download_client_remote_path_mapping_enabled === 'true',
      remotePath: pathMappingConfig.download_client_remote_path || '',
      localPath: pathMappingConfig.download_client_local_path || '',
    };

    // Find all active requests in awaiting_import status
    const requests = await prisma.request.findMany({
      where: {
        status: 'awaiting_import',
        deletedAt: null,
      },
      include: {
        audiobook: true,
        downloadHistory: {
          where: { selected: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      take: 50, // Limit to 50 requests per run
    });

    await logger?.info(`Found ${requests.length} requests awaiting import`);

    if (requests.length === 0) {
      return {
        success: true,
        message: 'No requests awaiting import',
        triggered: 0,
      };
    }

    // Trigger organize job for each request
    const jobQueue = getJobQueueService();
    let triggered = 0;
    let skipped = 0;

    for (const request of requests) {
      try {
        // Get the download path from the most recent download history
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory) {
          await logger?.warn(`No download history found for request ${request.id}, skipping`);
          skipped++;
          continue;
        }

        let downloadPath: string;

        // Try to get download path from qBittorrent if we have the torrent
        if (downloadHistory.downloadClientId) {
          try {
            const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
            const qbt = await getQBittorrentService();
            const torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
            const qbPath = `${torrent.save_path}/${torrent.name}`;
            downloadPath = PathMapper.transform(qbPath, mappingConfig);
            await logger?.info(
              `Got download path from qBittorrent for request ${request.id}: ${qbPath}` +
              (downloadPath !== qbPath ? ` → ${downloadPath} (mapped)` : '')
            );
          } catch (qbtError) {
            // Torrent not found in qBittorrent - try to construct path from config
            await logger?.warn(`Torrent not found in qBittorrent for request ${request.id}, falling back to configured path`);

            if (!downloadHistory.torrentName) {
              await logger?.warn(`No torrent name stored for request ${request.id}, cannot construct fallback path, skipping`);
              skipped++;
              continue;
            }

            const downloadDir = await configService.get('download_dir');

            if (!downloadDir) {
              await logger?.error(`download_dir not configured, cannot retry request ${request.id}, skipping`);
              skipped++;
              continue;
            }

            const fallbackPath = `${downloadDir}/${downloadHistory.torrentName}`;
            downloadPath = PathMapper.transform(fallbackPath, mappingConfig);
            await logger?.info(
              `Using fallback download path for request ${request.id}: ${fallbackPath}` +
              (downloadPath !== fallbackPath ? ` → ${downloadPath} (mapped)` : '')
            );
          }
        } else {
          // No download client ID - use fallback path
          if (!downloadHistory.torrentName) {
            await logger?.warn(`No download client ID or torrent name for request ${request.id}, skipping`);
            skipped++;
            continue;
          }

          const downloadDir = await configService.get('download_dir');

          if (!downloadDir) {
            await logger?.error(`download_dir not configured, cannot retry request ${request.id}, skipping`);
            skipped++;
            continue;
          }

          const configuredPath = `${downloadDir}/${downloadHistory.torrentName}`;
          downloadPath = PathMapper.transform(configuredPath, mappingConfig);
          await logger?.info(
            `Using configured download path for request ${request.id}: ${configuredPath}` +
            (downloadPath !== configuredPath ? ` → ${downloadPath} (mapped)` : '')
          );
        }

        await jobQueue.addOrganizeJob(
          request.id,
          request.audiobook.id,
          downloadPath
        );
        triggered++;
        await logger?.info(`Triggered organize job for request ${request.id}: ${request.audiobook.title}`);
      } catch (error) {
        await logger?.error(`Failed to trigger organize for request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        skipped++;
      }
    }

    await logger?.info(`Triggered ${triggered}/${requests.length} organize jobs (${skipped} skipped)`);

    return {
      success: true,
      message: 'Retry failed imports completed',
      totalRequests: requests.length,
      triggered,
      skipped,
    };
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
