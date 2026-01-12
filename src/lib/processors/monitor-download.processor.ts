/**
 * Component: Monitor Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import path from 'path';
import { MonitorDownloadPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getQBittorrentService } from '../integrations/qbittorrent.service';
import { RMABLogger } from '../utils/logger';
import { PathMapper } from '../utils/path-mapper';
import { getConfigService } from '../services/config.service';

/**
 * Helper function to retry getTorrent with exponential backoff
 * Handles race condition where torrent isn't immediately available after adding
 */
async function getTorrentWithRetry(
  qbt: any,
  hash: string,
  logger: RMABLogger,
  maxRetries: number = 3,
  initialDelayMs: number = 500
): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await qbt.getTorrent(hash);
    } catch (error) {
      lastError = error as Error;

      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        break;
      }

      // Exponential backoff: 500ms, 1000ms, 2000ms
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      logger.warn(`Torrent ${hash} not found, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries failed
  throw lastError || new Error('Failed to get torrent after retries');
}

/**
 * Process monitor download job
 * Checks download progress from download client and updates request status
 * Re-schedules itself if download is still in progress
 */
export async function processMonitorDownload(payload: MonitorDownloadPayload): Promise<any> {
  const { requestId, downloadHistoryId, downloadClientId, downloadClient, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'MonitorDownload');

  try {
    let progress: any;
    let downloadPath: string | undefined;

    if (downloadClient === 'qbittorrent') {
      // qBittorrent flow
      const qbt = await getQBittorrentService();

      // Get torrent status with retry logic (handles race condition)
      const torrent = await getTorrentWithRetry(qbt, downloadClientId, logger);
      progress = qbt.getDownloadProgress(torrent);

      // Store download path for later use
      downloadPath = torrent.content_path || path.join(torrent.save_path, torrent.name);
    } else if (downloadClient === 'sabnzbd') {
      // SABnzbd flow
      const { getSABnzbdService } = await import('../integrations/sabnzbd.service');
      const sabnzbd = await getSABnzbdService();

      // Get NZB status
      const nzbInfo = await sabnzbd.getNZB(downloadClientId);

      if (!nzbInfo) {
        throw new Error(`NZB ${downloadClientId} not found in SABnzbd queue or history`);
      }

      // Convert NZBInfo to progress format
      progress = {
        percent: nzbInfo.progress,
        bytesDownloaded: nzbInfo.size * nzbInfo.progress,
        bytesTotal: nzbInfo.size,
        speed: nzbInfo.downloadSpeed,
        eta: nzbInfo.timeLeft,
        state: nzbInfo.status,
      };

      // Store download path if available (only set after completion)
      downloadPath = nzbInfo.downloadPath;

      logger.info(`SABnzbd status: ${nzbInfo.status}`, {
        progress: `${(nzbInfo.progress * 100).toFixed(1)}%`,
        speed: `${(nzbInfo.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s`,
      });
    } else {
      throw new Error(`Download client ${downloadClient} not supported`);
    }

    // Update request progress
    await prisma.request.update({
      where: { id: requestId },
      data: {
        progress: progress.percent,
        updatedAt: new Date(),
      },
    });

    // Update download history
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        downloadStatus: progress.state,
      },
    });

    // Check download state
    if (progress.state === 'completed') {
      logger.info(`Download completed for request ${requestId}`);

      // Ensure we have a download path
      if (!downloadPath) {
        throw new Error('Download path not available from download client');
      }

      // Load path mapping configuration
      const configService = getConfigService();
      const pathMappingConfig = await configService.getMany([
        'download_client_remote_path_mapping_enabled',
        'download_client_remote_path',
        'download_client_local_path',
      ]);

      // Apply remote-to-local path transformation if enabled
      const organizePath = PathMapper.transform(downloadPath, {
        enabled: pathMappingConfig.download_client_remote_path_mapping_enabled === 'true',
        remotePath: pathMappingConfig.download_client_remote_path || '',
        localPath: pathMappingConfig.download_client_local_path || '',
      });

      logger.info(`Download completed`, {
        downloadClient,
        downloadPath,
        organizePath: organizePath !== downloadPath ? `${organizePath} (mapped)` : organizePath,
      });

      // Update download history to completed
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'completed',
          completedAt: new Date(),
        },
      });

      // Get request with audiobook details
      const request = await prisma.request.findFirst({
        where: {
          id: requestId,
          deletedAt: null,
        },
        include: {
          audiobook: true,
        },
      });

      if (!request || !request.audiobook) {
        throw new Error('Request or audiobook not found or deleted');
      }

      // Trigger organize files job with properly constructed path
      const jobQueue = getJobQueueService();
      await jobQueue.addOrganizeJob(
        requestId,
        request.audiobook.id,
        organizePath
      );

      logger.info(`Triggered organize_files job for request ${requestId}`);

      return {
        success: true,
        completed: true,
        message: 'Download completed, organizing files',
        requestId,
        progress: 100,
        downloadPath: organizePath,
      };
    } else if (progress.state === 'failed') {
      logger.error(`Download failed for request ${requestId}`);

      // Update request to failed
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: 'Download failed in qBittorrent',
          updatedAt: new Date(),
        },
      });

      // Update download history
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'failed',
          downloadError: 'Download failed in qBittorrent',
        },
      });

      return {
        success: false,
        completed: true,
        message: 'Download failed',
        requestId,
        progress: progress.percent,
      };
    } else {
      // Still downloading - schedule another check in 10 seconds
      const jobQueue = getJobQueueService();
      await jobQueue.addMonitorJob(
        requestId,
        downloadHistoryId,
        downloadClientId,
        downloadClient,
        10 // Delay 10 seconds between checks
      );

      // Only log every 5% progress to reduce log spam
      const shouldLog = progress.percent % 5 === 0 || progress.percent < 5;
      if (shouldLog) {
        logger.info(`Request ${requestId}: ${progress.percent}% complete (${progress.state})`, {
          speed: progress.speed,
          eta: progress.eta,
        });
      }

      return {
        success: true,
        completed: false,
        message: 'Download in progress, monitoring continues',
        requestId,
        progress: progress.percent,
        speed: progress.speed,
        eta: progress.eta,
        state: progress.state,
      };
    }
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Check if this is a transient "torrent not found" error
    const errorMessage = error instanceof Error ? error.message : '';
    const isTorrentNotFound = errorMessage.includes('not found') || errorMessage.includes('Torrent') && errorMessage.includes('not found');

    if (isTorrentNotFound) {
      // Transient error - don't mark request as failed, let Bull retry
      // The request stays in 'downloading' status until Bull exhausts all retries
      logger.warn(`Transient error for request ${requestId}, allowing Bull to retry`);
    } else {
      // Permanent error - mark request as failed immediately
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: errorMessage || 'Monitor download failed',
          updatedAt: new Date(),
        },
      });
    }

    // Rethrow to trigger Bull's retry mechanism
    throw error;
  }
}
