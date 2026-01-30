/**
 * Component: Search Ebook Job Processor
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Searches Anna's Archive for ebook downloads.
 * Part of the first-class ebook request flow.
 */

import { SearchEbookPayload, EbookSearchResult, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { RMABLogger } from '../utils/logger';

// Import ebook scraper functions (we'll refactor these to be reusable)
import {
  searchByAsin,
  searchByTitle,
  getSlowDownloadLinks,
} from '../services/ebook-scraper';

/**
 * Process search ebook job
 * Searches Anna's Archive for ebook matching the audiobook
 */
export async function processSearchEbook(payload: SearchEbookPayload): Promise<any> {
  const { requestId, audiobook, preferredFormat: payloadFormat, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'SearchEbook');

  logger.info(`Processing ebook request ${requestId} for "${audiobook.title}"`);

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

    // Get ebook configuration
    const configService = getConfigService();
    const preferredFormat = payloadFormat || await configService.get('ebook_sidecar_preferred_format') || 'epub';
    const baseUrl = await configService.get('ebook_sidecar_base_url') || 'https://annas-archive.li';
    const flaresolverrUrl = await configService.get('ebook_sidecar_flaresolverr_url') || undefined;

    if (flaresolverrUrl) {
      logger.info(`Using FlareSolverr at ${flaresolverrUrl}`);
    }

    let md5: string | null = null;
    let searchMethod: 'asin' | 'title' = 'title';

    // Step 1: Try ASIN search (exact match - best)
    if (audiobook.asin) {
      logger.info(`Searching by ASIN: ${audiobook.asin} (format: ${preferredFormat})...`);
      md5 = await searchByAsin(audiobook.asin, preferredFormat, baseUrl, logger, flaresolverrUrl);

      if (md5) {
        logger.info(`Found via ASIN: ${md5}`);
        searchMethod = 'asin';
      } else {
        logger.info(`No results for ASIN, falling back to title + author search...`);
      }
    }

    // Step 2: Fallback to title + author search
    if (!md5) {
      logger.info(`Searching by title + author: "${audiobook.title}" by ${audiobook.author}...`);
      md5 = await searchByTitle(audiobook.title, audiobook.author, preferredFormat, baseUrl, logger, flaresolverrUrl);

      if (md5) {
        logger.info(`Found via title search: ${md5}`);
        searchMethod = 'title';
      }
    }

    if (!md5) {
      // No results found - queue for re-search instead of failing
      logger.warn(`No ebook found for request ${requestId}, marking as awaiting_search`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'No ebook found on Anna\'s Archive. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No ebook found, queued for re-search',
        requestId,
      };
    }

    logger.info(`Found MD5: ${md5}`);

    // Step 3: Get slow download links
    const slowLinks = await getSlowDownloadLinks(md5, baseUrl, logger, flaresolverrUrl);

    if (slowLinks.length === 0) {
      logger.warn(`No download links available for MD5: ${md5}`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'Found ebook but no download links available. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No download links available, queued for re-search',
        requestId,
      };
    }

    logger.info(`Found ${slowLinks.length} download link(s)`);

    // Create ebook search result
    // Note: For future multi-source ranking, this would be one of many results
    const searchResult: EbookSearchResult = {
      md5,
      title: audiobook.title,
      author: audiobook.author,
      format: preferredFormat,
      downloadUrls: slowLinks,
      source: 'annas_archive',
      score: searchMethod === 'asin' ? 100 : 80, // ASIN match = higher confidence
    };

    // TODO: Future enhancement - when indexer support is added for ebooks:
    // 1. Search Prowlarr for ebook results (filtered to ebook categories)
    // 2. Rank results using rankEbookResults() with inverted size scoring
    // 3. Anna's Archive results should get priority bonus to come out on top
    // For now, Anna's Archive is the only source and always wins.

    logger.info(`==================== EBOOK SEARCH RESULT ====================`);
    logger.info(`Title: "${audiobook.title}"`);
    logger.info(`Author: "${audiobook.author}"`);
    logger.info(`Match Method: ${searchMethod === 'asin' ? 'ASIN (exact)' : 'Title + Author (fuzzy)'}`);
    logger.info(`Format: ${preferredFormat}`);
    logger.info(`MD5: ${md5}`);
    logger.info(`Download Links: ${slowLinks.length}`);
    logger.info(`Score: ${searchResult.score}/100`);
    logger.info(`==============================================================`);

    // Create download history record
    const downloadHistory = await prisma.downloadHistory.create({
      data: {
        requestId,
        indexerName: 'Anna\'s Archive',
        torrentName: `${audiobook.title} - ${audiobook.author}.${preferredFormat}`,
        torrentSizeBytes: null, // Unknown until download starts
        qualityScore: searchResult.score,
        selected: true,
        downloadClient: 'direct', // Direct HTTP download
        downloadStatus: 'queued',
      },
    });

    // Trigger direct download job with the best (only) result
    const jobQueue = getJobQueueService();

    // The first slow link will be tried; if it fails, the processor will try others
    await jobQueue.addStartDirectDownloadJob(
      requestId,
      downloadHistory.id,
      slowLinks[0], // Start with first link
      `${audiobook.title} - ${audiobook.author}.${preferredFormat}`,
      undefined // Size unknown
    );

    // Store all download URLs in download history for retry purposes
    await prisma.downloadHistory.update({
      where: { id: downloadHistory.id },
      data: {
        // Store additional URLs in torrentUrl field (JSON array)
        torrentUrl: JSON.stringify(slowLinks),
      },
    });

    return {
      success: true,
      message: `Found ebook via ${searchMethod === 'asin' ? 'ASIN' : 'title search'}, starting download`,
      requestId,
      searchResult: {
        md5: searchResult.md5,
        format: searchResult.format,
        score: searchResult.score,
        downloadLinksCount: slowLinks.length,
      },
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during ebook search',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
