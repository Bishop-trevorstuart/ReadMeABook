/**
 * Component: Retry Missing Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries search for requests that are awaiting torrent search
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';

export interface RetryMissingTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processRetryMissingTorrents(payload: RetryMissingTorrentsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'RetryMissingTorrents');

  logger.info('Starting retry job for requests awaiting search...');

  try {
    // Find all active requests in awaiting_search status
    const requests = await prisma.request.findMany({
      where: {
        status: 'awaiting_search',
        deletedAt: null,
      },
      include: {
        audiobook: true,
      },
      take: 50, // Limit to 50 requests per run
    });

    logger.info(`Found ${requests.length} requests awaiting search`);

    if (requests.length === 0) {
      return {
        success: true,
        message: 'No requests awaiting search',
        triggered: 0,
      };
    }

    // Trigger search job for each request
    const jobQueue = getJobQueueService();
    let triggered = 0;

    for (const request of requests) {
      try {
        await jobQueue.addSearchJob(request.id, {
          id: request.audiobook.id,
          title: request.audiobook.title,
          author: request.audiobook.author,
        });
        triggered++;
        logger.info(`Triggered search for request ${request.id}: ${request.audiobook.title}`);
      } catch (error) {
        logger.error(`Failed to trigger search for request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    logger.info(`Triggered ${triggered}/${requests.length} search jobs`);

    return {
      success: true,
      message: 'Retry missing torrents completed',
      totalRequests: requests.length,
      triggered,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
