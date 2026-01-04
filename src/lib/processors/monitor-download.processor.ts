/**
 * Component: Monitor Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import path from 'path';
import { MonitorDownloadPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getQBittorrentService } from '../integrations/qbittorrent.service';
import { createJobLogger, JobLogger } from '../utils/job-logger';
import { PathMapper } from '../utils/path-mapper';
import { getConfigService } from '../services/config.service';

/**
 * Helper function to retry getTorrent with exponential backoff
 * Handles race condition where torrent isn't immediately available after adding
 */
async function getTorrentWithRetry(
  qbt: any,
  hash: string,
  logger: JobLogger | null,
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
      await logger?.warn(`Torrent ${hash} not found, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);

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

  const logger = jobId ? createJobLogger(jobId, 'MonitorDownload') : null;

  try {
    // Get download client service (currently only qBittorrent supported)
    if (downloadClient !== 'qbittorrent') {
      throw new Error(`Download client ${downloadClient} not yet supported`);
    }

    const qbt = await getQBittorrentService();

    // Get torrent status with retry logic (handles race condition)
    const torrent = await getTorrentWithRetry(qbt, downloadClientId, logger);
    const progress = qbt.getDownloadProgress(torrent);

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
      await logger?.info(`Download completed for request ${requestId}`);

      // Get torrent files to find download path
      const files = await qbt.getFiles(downloadClientId);

      // Determine actual content path for file organization
      // Priority 1: Use content_path if provided by qBittorrent (most reliable)
      // Priority 2: Construct path using path.join() for proper normalization
      const qbPath = torrent.content_path
        ? torrent.content_path
        : path.join(torrent.save_path, torrent.name);

      // Load path mapping configuration
      const configService = getConfigService();
      const pathMappingConfig = await configService.getMany([
        'download_client_remote_path_mapping_enabled',
        'download_client_remote_path',
        'download_client_local_path',
      ]);

      // Apply remote-to-local path transformation if enabled
      const organizePath = PathMapper.transform(qbPath, {
        enabled: pathMappingConfig.download_client_remote_path_mapping_enabled === 'true',
        remotePath: pathMappingConfig.download_client_remote_path || '',
        localPath: pathMappingConfig.download_client_local_path || '',
      });

      await logger?.info(`Download completed`, {
        filesCount: files.length,
        torrentName: torrent.name,
        savePath: torrent.save_path,
        contentPath: torrent.content_path || '(not provided)',
        qbittorrentPath: qbPath,
        organizePath: organizePath !== qbPath ? `${organizePath} (mapped)` : organizePath,
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

      await logger?.info(`Triggered organize_files job for request ${requestId}`);

      return {
        success: true,
        completed: true,
        message: 'Download completed, organizing files',
        requestId,
        progress: 100,
        downloadPath: organizePath,
      };
    } else if (progress.state === 'failed') {
      await logger?.error(`Download failed for request ${requestId}`);

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
        await logger?.info(`Request ${requestId}: ${progress.percent}% complete (${progress.state})`, {
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
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Check if this is a transient "torrent not found" error
    const errorMessage = error instanceof Error ? error.message : '';
    const isTorrentNotFound = errorMessage.includes('not found') || errorMessage.includes('Torrent') && errorMessage.includes('not found');

    if (isTorrentNotFound) {
      // Transient error - don't mark request as failed, let Bull retry
      // The request stays in 'downloading' status until Bull exhausts all retries
      await logger?.warn(`Transient error for request ${requestId}, allowing Bull to retry`);
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
