/**
 * Component: Request Deletion Service
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Handles soft deletion of requests with intelligent torrent/file cleanup
 */

import { prisma } from '../db';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DeleteRequestResult {
  success: boolean;
  message: string;
  filesDeleted: boolean;
  torrentsRemoved: number;
  torrentsKeptSeeding: number;
  torrentsKeptUnlimited: number;
  error?: string;
}

/**
 * Soft delete a request with intelligent cleanup of media files and torrents
 *
 * Logic:
 * 1. Check if request exists and is not already deleted
 * 2. For each download:
 *    - If unlimited seeding (0): Log and keep seeding, no monitoring
 *    - If incomplete download: Delete torrent + files
 *    - If seeding requirement met: Delete torrent + files
 *    - If still seeding: Keep in qBittorrent for cleanup job
 * 3. Delete media files (title folder only)
 * 4. Soft delete request (set deletedAt, deletedBy)
 */
export async function deleteRequest(
  requestId: string,
  adminUserId: string
): Promise<DeleteRequestResult> {
  try {
    // 1. Find request (only active, non-deleted)
    const request = await prisma.request.findFirst({
      where: {
        id: requestId,
        deletedAt: null,
      },
      include: {
        audiobook: {
          select: {
            id: true,
            title: true,
            author: true,
            audibleAsin: true,
            plexGuid: true,
            absItemId: true,
          },
        },
        downloadHistory: {
          where: {
            selected: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!request) {
      return {
        success: false,
        message: 'Request not found or already deleted',
        filesDeleted: false,
        torrentsRemoved: 0,
        torrentsKeptSeeding: 0,
        torrentsKeptUnlimited: 0,
        error: 'NotFound',
      };
    }

    let torrentsRemoved = 0;
    let torrentsKeptSeeding = 0;
    let torrentsKeptUnlimited = 0;

    // 2. Handle downloads & seeding
    const downloadHistory = request.downloadHistory[0];

    if (downloadHistory && downloadHistory.downloadClientId && downloadHistory.indexerName) {
      try {
        // Get indexer seeding configuration
        const { getConfigService } = await import('./config.service');
        const configService = getConfigService();
        const indexersConfigStr = await configService.get('prowlarr_indexers');

        let seedingConfig: any = null;
        if (indexersConfigStr) {
          const indexersConfig = JSON.parse(indexersConfigStr);
          seedingConfig = indexersConfig.find(
            (idx: any) => idx.name === downloadHistory.indexerName
          );
        }

        // Get torrent from qBittorrent
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();

        let torrent;
        try {
          torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
        } catch (error) {
          // Torrent not found in qBittorrent (already removed)
          console.log(`[RequestDelete] Torrent ${downloadHistory.downloadClientId} not found in qBittorrent, skipping`);
        }

        if (torrent) {
          // Torrent exists in qBittorrent
          const isUnlimitedSeeding = !seedingConfig || seedingConfig.seedingTimeMinutes === 0;
          const isCompleted = downloadHistory.downloadStatus === 'completed';

          if (isUnlimitedSeeding) {
            // Unlimited seeding - keep in qBittorrent, stop monitoring
            console.log(
              `[RequestDelete] Keeping torrent ${torrent.name} for unlimited seeding (indexer: ${downloadHistory.indexerName})`
            );
            torrentsKeptUnlimited++;
          } else if (!isCompleted) {
            // Download not completed - delete immediately
            console.log(
              `[RequestDelete] Deleting incomplete download: ${torrent.name}`
            );
            await qbt.deleteTorrent(downloadHistory.downloadClientId, true);
            torrentsRemoved++;
          } else {
            // Check if seeding requirement is met
            const seedingTimeSeconds = seedingConfig.seedingTimeMinutes * 60;
            const actualSeedingTime = torrent.seeding_time || 0;
            const hasMetRequirement = actualSeedingTime >= seedingTimeSeconds;

            if (hasMetRequirement) {
              // Seeding requirement met - delete now
              console.log(
                `[RequestDelete] Deleting torrent ${torrent.name} (seeding complete: ${Math.floor(
                  actualSeedingTime / 60
                )}/${seedingConfig.seedingTimeMinutes} minutes)`
              );
              await qbt.deleteTorrent(downloadHistory.downloadClientId, true);
              torrentsRemoved++;
            } else {
              // Still needs seeding - keep for cleanup job
              const remainingMinutes = Math.ceil((seedingTimeSeconds - actualSeedingTime) / 60);
              console.log(
                `[RequestDelete] Keeping torrent ${torrent.name} for ${remainingMinutes} more minutes of seeding`
              );
              torrentsKeptSeeding++;
            }
          }
        }
      } catch (error) {
        console.error(
          `[RequestDelete] Error handling torrent for request ${requestId}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        // Continue with deletion even if torrent handling fails
      }
    }

    // 3. Delete media files (title folder only)
    let filesDeleted = false;
    try {
      const { getConfigService } = await import('./config.service');
      const configService = getConfigService();
      const mediaDir = (await configService.get('media_dir')) || '/media/audiobooks';

      // Sanitize author and title for path (same logic as file-organizer.ts)
      const sanitizedAuthor = sanitizePath(request.audiobook.author);
      const sanitizedTitle = sanitizePath(request.audiobook.title);

      // Build folder name with optional year and ASIN (matches file-organizer.ts logic)
      let folderName = sanitizedTitle;

      // Get ASIN and check for year in AudibleCache
      const asin = request.audiobook.audibleAsin;
      let year: number | undefined;

      if (asin) {
        // Try to get year from AudibleCache if it exists
        const audibleCache = await prisma.audibleCache.findUnique({
          where: { asin },
          select: { releaseDate: true },
        });

        if (audibleCache?.releaseDate) {
          year = new Date(audibleCache.releaseDate).getFullYear();
        }
      }

      if (year) {
        folderName = `${folderName} (${year})`;
      }

      if (asin) {
        folderName = `${folderName} ${asin}`;
      }

      // Build path: [media_dir]/[author]/[title (year) asin]/
      const titleFolderPath = path.join(mediaDir, sanitizedAuthor, folderName);

      // Check if folder exists
      try {
        await fs.access(titleFolderPath);

        // Delete the title folder (not the author folder)
        await fs.rm(titleFolderPath, { recursive: true, force: true });

        console.log(`[RequestDelete] Deleted media directory: ${titleFolderPath}`);
        filesDeleted = true;
      } catch (accessError) {
        // Folder doesn't exist - try without year/ASIN (fallback for older files)
        const fallbackPath = path.join(mediaDir, sanitizedAuthor, sanitizedTitle);
        try {
          await fs.access(fallbackPath);
          await fs.rm(fallbackPath, { recursive: true, force: true });
          console.log(`[RequestDelete] Deleted media directory (fallback path): ${fallbackPath}`);
          filesDeleted = true;
        } catch (fallbackError) {
          // Neither path exists - that's okay
          console.log(
            `[RequestDelete] Media directory not found (tried: ${titleFolderPath}, ${fallbackPath})`
          );
          filesDeleted = false;
        }
      }
    } catch (error) {
      console.error(
        `[RequestDelete] Error deleting media files for request ${requestId}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      // Continue with soft delete even if file deletion fails
    }

    // 4. Delete from plex_library table and clear audiobook availability
    // This ensures the book immediately shows as NOT available when searching
    try {
      const { getConfigService } = await import('./config.service');
      const configService = getConfigService();
      const backendMode = await configService.getBackendMode();

      // Delete ALL plex_library records matching this audiobook's title and author
      // This handles cases where there might be duplicate library records
      // and ensures the book doesn't show as "In Your Library" during searches
      try {
        // Find all matching library records (by title/author fuzzy match)
        const matchingLibraryRecords = await prisma.plexLibrary.findMany({
          where: {
            title: {
              contains: request.audiobook.title.substring(0, 20),
              mode: 'insensitive',
            },
          },
        });

        // Filter to exact matches (case-insensitive title and author)
        const exactMatches = matchingLibraryRecords.filter((record) => {
          const titleMatch = record.title.toLowerCase() === request.audiobook.title.toLowerCase();
          const authorMatch = record.author.toLowerCase() === request.audiobook.author.toLowerCase();
          return titleMatch && authorMatch;
        });

        if (exactMatches.length > 0) {
          // Delete all exact matches
          const deletePromises = exactMatches.map((record) =>
            prisma.plexLibrary.delete({ where: { id: record.id } })
          );

          await Promise.all(deletePromises);

          console.log(
            `[RequestDelete] Deleted ${exactMatches.length} plex_library record(s) for "${request.audiobook.title}"`
          );
        } else {
          console.log(
            `[RequestDelete] No plex_library records found for "${request.audiobook.title}"`
          );
        }
      } catch (libError) {
        console.error(
          `[RequestDelete] Error deleting plex_library records:`,
          libError instanceof Error ? libError.message : 'Unknown error'
        );
        // Continue with deletion even if library cleanup fails
      }

      // Clear audiobook record linkage
      const updateData: any = {
        status: 'requested', // Reset to requested state
        updatedAt: new Date(),
      };

      // Clear library linkage based on backend mode
      if (backendMode === 'audiobookshelf') {
        updateData.absItemId = null;
      } else {
        updateData.plexGuid = null;
      }

      await prisma.audiobook.update({
        where: { id: request.audiobook.id },
        data: updateData,
      });

      console.log(
        `[RequestDelete] Cleared availability status for audiobook ${request.audiobook.id}`
      );
    } catch (error) {
      console.error(
        `[RequestDelete] Error clearing audiobook status:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      // Continue with deletion even if this fails
    }

    // 5. Soft delete request
    await prisma.request.update({
      where: { id: requestId },
      data: {
        deletedAt: new Date(),
        deletedBy: adminUserId,
      },
    });

    console.log(
      `[RequestDelete] Request ${requestId} soft-deleted by admin ${adminUserId}`
    );

    return {
      success: true,
      message: 'Request deleted successfully',
      filesDeleted,
      torrentsRemoved,
      torrentsKeptSeeding,
      torrentsKeptUnlimited,
    };
  } catch (error) {
    console.error(
      `[RequestDelete] Failed to delete request ${requestId}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );

    return {
      success: false,
      message: 'Failed to delete request',
      filesDeleted: false,
      torrentsRemoved: 0,
      torrentsKeptSeeding: 0,
      torrentsKeptUnlimited: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sanitize a path component (removes invalid characters)
 */
function sanitizePath(input: string): string {
  return (
    input
      // Remove invalid path characters
      .replace(/[<>:"/\\|?*]/g, '')
      // Trim dots and spaces from start/end
      .replace(/^[.\s]+|[.\s]+$/g, '')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      // Limit length
      .substring(0, 200)
      .trim()
  );
}
