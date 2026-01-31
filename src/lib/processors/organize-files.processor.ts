/**
 * Component: Organize Files Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { OrganizeFilesPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getFileOrganizer } from '../utils/file-organizer';
import { RMABLogger } from '../utils/logger';
import { getLibraryService } from '../services/library';
import { getConfigService } from '../services/config.service';
import { generateFilesHash } from '../utils/files-hash';

/**
 * Process organize files job
 * Moves completed downloads to media library in proper directory structure
 * Handles both audiobook and ebook request types with appropriate branching
 */
export async function processOrganizeFiles(payload: OrganizeFilesPayload): Promise<any> {
  const { requestId, audiobookId, downloadPath, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'OrganizeFiles');

  logger.info(`Processing request ${requestId}`);
  logger.info(`Download path: ${downloadPath}`);

  try {
    // Fetch request to determine type
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        user: { select: { plexUsername: true } },
      },
    });

    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    const requestType = request.type || 'audiobook'; // Default to audiobook for backward compatibility
    logger.info(`Request type: ${requestType}`);

    // Branch based on request type
    if (requestType === 'ebook') {
      return await processEbookOrganization(payload, request, logger);
    }

    // Continue with audiobook organization flow
    // Update request status to processing
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'processing',
        progress: 100, // Download is complete, now organizing
        updatedAt: new Date(),
      },
    });

    // Get audiobook details
    const audiobook = await prisma.audiobook.findUnique({
      where: { id: audiobookId },
    });

    if (!audiobook) {
      throw new Error(`Audiobook ${audiobookId} not found`);
    }

    logger.info(`Organizing: ${audiobook.title} by ${audiobook.author}`);

    // Fetch year from multiple sources (priority order)
    let year = audiobook.year || undefined;
    logger.info(`Initial year from audiobook record: ${year || 'null'}`);

    if (!year && audiobook.audibleAsin) {
      logger.info(`No year in audiobook record, attempting to fetch from AudibleCache for ASIN: ${audiobook.audibleAsin}`);

      // Try AudibleCache (for popular/new releases)
      const audibleCache = await prisma.audibleCache.findUnique({
        where: { asin: audiobook.audibleAsin },
        select: { releaseDate: true },
      });

      if (audibleCache?.releaseDate) {
        logger.info(`Found AudibleCache entry with releaseDate: ${audibleCache.releaseDate}`);
        year = new Date(audibleCache.releaseDate).getFullYear();
        logger.info(`Extracted year ${year} from AudibleCache releaseDate`);

        // Update audiobook record with year for future use
        await prisma.audiobook.update({
          where: { id: audiobookId },
          data: { year },
        });
        logger.info(`Updated audiobook record with year ${year}`);
      } else {
        logger.info(`No year found in AudibleCache for ASIN ${audiobook.audibleAsin}`);
      }
    }

    logger.info(`Final year value for path organization: ${year || 'null (year will be omitted from path)'}`)

    // Get file organizer (reads media_dir from database config)
    const organizer = await getFileOrganizer();

    // Read path template from configuration
    const templateConfig = await prisma.configuration.findUnique({
      where: { key: 'audiobook_path_template' },
    });
    const template = templateConfig?.value || '{author}/{title} {asin}';

    // Organize files (pass template and logger to file organizer)
    const result = await organizer.organize(
      downloadPath,
      {
        title: audiobook.title,
        author: audiobook.author,
        narrator: audiobook.narrator || undefined,
        coverArtUrl: audiobook.coverArtUrl || undefined,
        asin: audiobook.audibleAsin || undefined,
        year,
        series: audiobook.series || undefined,
        seriesPart: audiobook.seriesPart || undefined,
      },
      template,
      jobId ? { jobId, context: 'FileOrganizer' } : undefined
    );

    if (!result.success) {
      throw new Error(`File organization failed: ${result.errors.join(', ')}`);
    }

    logger.info(`Successfully moved ${result.filesMovedCount} files to ${result.targetPath}`);

    // Generate hash from organized audio files for library matching
    const filesHash = generateFilesHash(result.audioFiles);
    if (filesHash) {
      logger.info(`Generated files hash: ${filesHash.substring(0, 16)}... (${result.audioFiles.length} audio files)`);
    }

    // Update audiobook record with file path, hash, and status
    await prisma.audiobook.update({
      where: { id: audiobookId },
      data: {
        filePath: result.targetPath,
        filesHash: filesHash || null,
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update request to downloaded (green status, waiting for Plex scan)
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'downloaded',
        progress: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(`Request ${requestId} completed successfully - status: downloaded`, {
      success: true,
      message: 'Files organized successfully',
      requestId,
      audiobookId,
      targetPath: result.targetPath,
      filesCount: result.filesMovedCount,
      audioFiles: result.audioFiles,
      coverArt: result.coverArtFile,
      errors: result.errors,
    });

    // Create ebook request if ebook downloads enabled (for audiobook requests only)
    // This replaces the old inline ebook sidecar download
    await createEbookRequestIfEnabled(requestId, audiobook, request.userId, result.targetPath, logger);

    // Trigger filesystem scan if enabled (Plex or Audiobookshelf)
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();

    const configKey = backendMode === 'audiobookshelf'
      ? 'audiobookshelf.trigger_scan_after_import'
      : 'plex.trigger_scan_after_import';

    const scanEnabled = await configService.get(configKey);

    if (scanEnabled === 'true') {
      try {
        // Get library service (returns PlexLibraryService or AudiobookshelfLibraryService)
        const libraryService = await getLibraryService();

        // Get configured library ID (backend-specific config)
        const libraryId = backendMode === 'audiobookshelf'
          ? await configService.get('audiobookshelf.library_id')
          : await configService.get('plex_audiobook_library_id');

        if (!libraryId) {
          throw new Error('Library ID not configured');
        }

        // Trigger scan (implementation is backend-specific)
        await libraryService.triggerLibraryScan(libraryId);

        logger.info(
          `Triggered ${backendMode} filesystem scan for library ${libraryId}`
        );

      } catch (error) {
        // Log error but don't fail the job
        logger.error(
          `Failed to trigger filesystem scan: ${error instanceof Error ? error.message : 'Unknown error'}`,
          {
            error: error instanceof Error ? error.stack : undefined,
            backend: backendMode
          }
        );
        // Continue - scheduled scans will eventually detect the book
      }
    } else {
      logger.info(
        `${backendMode} filesystem scan trigger disabled (relying on filesystem watcher)`
      );
    }

    // Cleanup Usenet downloads if configured
    try {
      logger.info('Checking if cleanup is needed for this download');

      // Get download history to find NZB ID and indexer
      const downloadHistory = await prisma.downloadHistory.findFirst({
        where: { requestId },
        orderBy: { createdAt: 'desc' },
      });

      logger.info(`Download history found: ${downloadHistory ? 'yes' : 'no'}`, {
        hasNzbId: !!downloadHistory?.nzbId,
        hasIndexerId: !!downloadHistory?.indexerId,
        nzbId: downloadHistory?.nzbId || 'none',
        indexerId: downloadHistory?.indexerId || 'none',
      });

      if (downloadHistory?.nzbId && downloadHistory?.indexerId) {
        // Get indexer configuration
        const indexersConfig = await configService.get('prowlarr_indexers');
        logger.info(`Indexers config found: ${indexersConfig ? 'yes' : 'no'}`);

        if (indexersConfig) {
          const indexers: Array<{ id: number; protocol: string; removeAfterProcessing?: boolean }> = JSON.parse(indexersConfig);
          const indexer = indexers.find(idx => idx.id === downloadHistory.indexerId);

          logger.info(`Indexer found in config: ${indexer ? 'yes' : 'no'}`, {
            indexerId: downloadHistory.indexerId,
            protocol: indexer?.protocol || 'none',
            removeAfterProcessing: indexer?.removeAfterProcessing ?? 'undefined',
          });

          // Check if this is a Usenet indexer with cleanup enabled
          if (indexer && indexer.protocol?.toLowerCase() !== 'torrent' && indexer.removeAfterProcessing) {
            logger.info(`Cleaning up NZB ${downloadHistory.nzbId} (cleanup enabled for indexer ${indexer.id})`);

            // First, manually delete files from filesystem
            if (downloadPath) {
              logger.info(`Removing download files from filesystem: ${downloadPath}`);

              const fs = await import('fs/promises');

              try {
                // Check if it's a file or directory
                const stats = await fs.stat(downloadPath);

                if (stats.isDirectory()) {
                  // Remove directory and all contents
                  await fs.rm(downloadPath, { recursive: true, force: true });
                  logger.info(`Removed directory: ${downloadPath}`);
                } else {
                  // Remove single file
                  await fs.unlink(downloadPath);
                  logger.info(`Removed file: ${downloadPath}`);
                }
              } catch (fsError) {
                // File/directory might already be deleted or not exist
                if ((fsError as NodeJS.ErrnoException).code === 'ENOENT') {
                  logger.info(`Download path already deleted: ${downloadPath}`);
                } else {
                  throw fsError;
                }
              }
            } else {
              logger.warn(`No download path available, skipping filesystem deletion`);
            }

            // Then archive from SABnzbd history (hides from UI but preserves for troubleshooting)
            // Note: We only archive from history, not queue. If the NZB is still in the queue
            // when we're organizing files, something went wrong with the download monitoring.
            const { getSABnzbdService } = await import('../integrations/sabnzbd.service');
            const sabnzbd = await getSABnzbdService();

            await sabnzbd.archiveCompletedNZB(downloadHistory.nzbId);

            logger.info(`Successfully archived NZB ${downloadHistory.nzbId} and removed files`);
          }
        }
      }
    } catch (error) {
      // Log error but don't fail the job - cleanup is optional
      logger.warn(
        `Failed to cleanup NZB download: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }

    return {
      success: true,
      message: 'Files organized successfully',
      requestId,
      audiobookId,
      targetPath: result.targetPath,
      filesCount: result.filesMovedCount,
      audioFiles: result.audioFiles,
      coverArt: result.coverArtFile,
      errors: result.errors,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    const errorMessage = error instanceof Error ? error.message : 'File organization failed';

    // Check if this is a retryable error (transient filesystem issues or no files found)
    const isRetryableError =
      errorMessage.includes('No audiobook files found') ||
      errorMessage.includes('ENOENT') || // File/directory not found
      errorMessage.includes('no such file or directory') ||
      errorMessage.includes('EACCES') || // Permission denied (might be temporary)
      errorMessage.includes('EPERM');    // Operation not permitted (might be temporary)

    if (isRetryableError) {
      // Get current request to check retry count
      const currentRequest = await prisma.request.findFirst({
        where: {
          id: requestId,
          deletedAt: null,
        },
        select: { importAttempts: true, maxImportRetries: true },
      });

      if (!currentRequest) {
        throw new Error('Request not found or deleted');
      }

      const newAttempts = currentRequest.importAttempts + 1;

      if (newAttempts < currentRequest.maxImportRetries) {
        // Still have retries left - queue for re-import
        logger.warn(`Retryable error for request ${requestId}, queueing for retry (attempt ${newAttempts}/${currentRequest.maxImportRetries})`);

        await prisma.request.update({
          where: { id: requestId },
          data: {
            status: 'awaiting_import',
            importAttempts: newAttempts,
            lastImportAt: new Date(),
            errorMessage: `${errorMessage}. Retry ${newAttempts}/${currentRequest.maxImportRetries}`,
            updatedAt: new Date(),
          },
        });

        return {
          success: false,
          message: 'Retryable error detected, queued for re-import',
          requestId,
          attempts: newAttempts,
          maxRetries: currentRequest.maxImportRetries,
        };
      } else {
        // Max retries exceeded - move to warn status
        logger.warn(`Max retries (${currentRequest.maxImportRetries}) exceeded for request ${requestId}, moving to warn status`);

        const warnMessage = `${errorMessage}. Max retries (${currentRequest.maxImportRetries}) exceeded. Manual retry available.`;

        await prisma.request.update({
          where: { id: requestId },
          data: {
            status: 'warn',
            importAttempts: newAttempts,
            errorMessage: warnMessage,
            updatedAt: new Date(),
          },
        });

        // Send notification for request failure
        const request = await prisma.request.findUnique({
          where: { id: requestId },
          include: {
            audiobook: true,
            user: { select: { plexUsername: true } },
          },
        });

        if (request) {
          const jobQueue = getJobQueueService();
          await jobQueue.addNotificationJob(
            'request_error',
            request.id,
            request.audiobook.title,
            request.audiobook.author,
            request.user.plexUsername || 'Unknown User',
            warnMessage
          ).catch((error) => {
            logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
          });
        }

        return {
          success: false,
          message: 'Max import retries exceeded, manual intervention required',
          requestId,
          attempts: newAttempts,
          maxRetries: currentRequest.maxImportRetries,
        };
      }
    } else {
      // Other error - fail immediately
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage,
          updatedAt: new Date(),
        },
      });

      // Send notification for request failure
      const request = await prisma.request.findUnique({
        where: { id: requestId },
        include: {
          audiobook: true,
          user: { select: { plexUsername: true } },
        },
      });

      if (request) {
        const jobQueue = getJobQueueService();
        await jobQueue.addNotificationJob(
          'request_error',
          request.id,
          request.audiobook.title,
          request.audiobook.author,
          request.user.plexUsername || 'Unknown User',
          errorMessage
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      }

      throw error;
    }
  }
}

// =========================================================================
// EBOOK-SPECIFIC ORGANIZATION
// =========================================================================

/**
 * Process ebook organization (simplified flow compared to audiobooks)
 * - No metadata tagging
 * - No cover art download
 * - No files hash generation
 * - Sends "available" notification at downloaded state (terminal for ebooks)
 */
async function processEbookOrganization(
  payload: OrganizeFilesPayload,
  request: { id: string; userId: string; type: string; user: { plexUsername: string | null } },
  logger: RMABLogger
): Promise<any> {
  const { requestId, audiobookId, downloadPath, jobId } = payload;

  logger.info(`Processing ebook organization for request ${requestId}`);

  // Update request status to processing
  await prisma.request.update({
    where: { id: requestId },
    data: {
      status: 'processing',
      progress: 100,
      updatedAt: new Date(),
    },
  });

  // Get book details (works for both audiobooks and ebooks)
  const book = await prisma.audiobook.findUnique({
    where: { id: audiobookId },
  });

  if (!book) {
    throw new Error(`Book ${audiobookId} not found`);
  }

  logger.info(`Organizing ebook: ${book.title} by ${book.author}`);

  // Get file organizer and template
  const organizer = await getFileOrganizer();
  const templateConfig = await prisma.configuration.findUnique({
    where: { key: 'audiobook_path_template' },
  });
  const template = templateConfig?.value || '{author}/{title} {asin}';

  // Organize ebook files (organizer will detect ebook type and skip audio-specific processing)
  const result = await organizer.organizeEbook(
    downloadPath,
    {
      title: book.title,
      author: book.author,
      asin: book.audibleAsin || undefined,
      year: book.year || undefined,
    },
    template,
    jobId ? { jobId, context: 'FileOrganizer.Ebook' } : undefined
  );

  if (!result.success) {
    throw new Error(`Ebook organization failed: ${result.errors.join(', ')}`);
  }

  logger.info(`Successfully moved ebook to ${result.targetPath}`);

  // Update book record with file path
  await prisma.audiobook.update({
    where: { id: audiobookId },
    data: {
      filePath: result.targetPath,
      fileFormat: result.format || 'epub',
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Update request to downloaded (terminal state for ebooks)
  await prisma.request.update({
    where: { id: requestId },
    data: {
      status: 'downloaded',
      progress: 100,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  logger.info(`Ebook request ${requestId} completed - status: downloaded (terminal)`);

  // Send "available" notification for ebooks at downloaded state
  // (since ebooks don't transition to 'available' via Plex matching)
  const jobQueue = getJobQueueService();
  await jobQueue.addNotificationJob(
    'request_available',
    requestId,
    book.title,
    book.author,
    request.user.plexUsername || 'Unknown User'
  ).catch((error) => {
    logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
  });

  // Trigger filesystem scan if enabled (same as audiobooks)
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();
  const configKey = backendMode === 'audiobookshelf'
    ? 'audiobookshelf.trigger_scan_after_import'
    : 'plex.trigger_scan_after_import';
  const scanEnabled = await configService.get(configKey);

  logger.debug(`Ebook library scan check: backendMode=${backendMode}, configKey=${configKey}, scanEnabled=${scanEnabled}`);

  if (scanEnabled === 'true') {
    try {
      const libraryService = await getLibraryService();
      const libraryId = backendMode === 'audiobookshelf'
        ? await configService.get('audiobookshelf.library_id')
        : await configService.get('plex_audiobook_library_id');

      if (libraryId) {
        await libraryService.triggerLibraryScan(libraryId);
        logger.info(`Triggered ${backendMode} filesystem scan for library ${libraryId}`);
      } else {
        logger.warn(`Library ID not configured for ${backendMode}, skipping scan`);
      }
    } catch (error) {
      logger.error(`Failed to trigger filesystem scan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    logger.debug(`Ebook library scan disabled (scanEnabled=${scanEnabled})`);
  }

  return {
    success: true,
    message: 'Ebook organized successfully',
    requestId,
    audiobookId,
    targetPath: result.targetPath,
    format: result.format,
  };
}

/**
 * Create ebook request if ebook downloads are enabled
 * Called after audiobook organization completes
 *
 * Supports two ebook sources:
 * - Anna's Archive (ebook_annas_archive_enabled) - Currently implemented
 * - Indexer Search (ebook_indexer_search_enabled) - Future feature, gracefully skipped
 */
async function createEbookRequestIfEnabled(
  parentRequestId: string,
  audiobook: { id: string; title: string; author: string; audibleAsin: string | null },
  userId: string,
  targetPath: string,
  logger: RMABLogger
): Promise<void> {
  try {
    // Check which ebook sources are enabled
    const configService = getConfigService();
    const annasArchiveEnabled = await configService.get('ebook_annas_archive_enabled');
    const indexerSearchEnabled = await configService.get('ebook_indexer_search_enabled');

    // Legacy migration: check old key if new keys don't exist
    const legacyEnabled = await configService.get('ebook_sidecar_enabled');
    const isAnnasArchiveEnabled = annasArchiveEnabled === 'true' ||
      (annasArchiveEnabled === null && legacyEnabled === 'true');
    const isIndexerSearchEnabled = indexerSearchEnabled === 'true';

    // If no sources are enabled, skip ebook creation
    if (!isAnnasArchiveEnabled && !isIndexerSearchEnabled) {
      logger.info('Ebook downloads disabled (no sources enabled), skipping ebook request creation');
      return;
    }

    // If only indexer search is enabled (not yet implemented), log and skip
    if (!isAnnasArchiveEnabled && isIndexerSearchEnabled) {
      logger.info('Ebook indexer search is enabled but not yet implemented, skipping ebook request creation');
      return;
    }

    // Anna's Archive is enabled - proceed with ebook request creation

    // Check if an ebook request already exists for this parent
    const existingEbookRequest = await prisma.request.findFirst({
      where: {
        parentRequestId,
        type: 'ebook',
        deletedAt: null,
      },
    });

    if (existingEbookRequest) {
      logger.info(`Ebook request already exists for parent ${parentRequestId}: ${existingEbookRequest.id}`);
      return;
    }

    logger.info(`Creating ebook request for "${audiobook.title}" (parent: ${parentRequestId})`);

    // Create new ebook request (auto-approved since parent was approved)
    const ebookRequest = await prisma.request.create({
      data: {
        userId,
        audiobookId: audiobook.id,
        type: 'ebook',
        parentRequestId,
        status: 'pending', // Will trigger search_ebook job
        progress: 0,
      },
    });

    logger.info(`Created ebook request ${ebookRequest.id}`);

    // Trigger ebook search job (Anna's Archive)
    const jobQueue = getJobQueueService();
    await jobQueue.addSearchEbookJob(ebookRequest.id, {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
      asin: audiobook.audibleAsin || undefined,
    });

    logger.info(`Triggered search_ebook job for request ${ebookRequest.id}`);
  } catch (error) {
    // Don't fail the main audiobook organization if ebook request creation fails
    logger.error(`Failed to create ebook request: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
