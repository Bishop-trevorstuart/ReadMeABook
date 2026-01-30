/**
 * Component: Admin Active Downloads API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getQBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { getSABnzbdService } from '@/lib/integrations/sabnzbd.service';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Downloads');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Get active downloads with related data (both audiobook and ebook)
    const activeDownloads = await prisma.request.findMany({
      where: {
        status: 'downloading',
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        type: true, // 'audiobook' or 'ebook'
        progress: true,
        updatedAt: true,
        audiobook: {
          select: {
            id: true,
            title: true,
            author: true,
          },
        },
        user: {
          select: {
            id: true,
            plexUsername: true,
          },
        },
        downloadHistory: {
          where: {
            downloadStatus: 'downloading',
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            downloadStatus: true,
            torrentName: true,
            torrentHash: true,
            nzbId: true,
            downloadClient: true, // qbittorrent, sabnzbd, or direct
            torrentSizeBytes: true,
            startedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 20,
    });

    // Get configured download client type
    const configService = getConfigService();
    const clientType = (await configService.get('download_client_type')) || 'qbittorrent';

    // Format response with speed and ETA from download client
    const formatted = await Promise.all(
      activeDownloads.map(async (download) => {
        let speed = 0;
        let eta: number | null = null;

        const downloadHistory = download.downloadHistory[0];
        const downloadClient = downloadHistory?.downloadClient;

        try {
          if (downloadClient === 'direct') {
            // Direct HTTP download (ebooks) - estimate speed from progress and time elapsed
            const startedAt = downloadHistory?.startedAt || downloadHistory?.createdAt;
            const totalSize = downloadHistory?.torrentSizeBytes ? Number(downloadHistory.torrentSizeBytes) : 0;

            if (startedAt && download.progress > 0 && totalSize > 0) {
              const elapsedMs = Date.now() - new Date(startedAt).getTime();
              const elapsedSeconds = elapsedMs / 1000;
              const bytesDownloaded = (download.progress / 100) * totalSize;

              if (elapsedSeconds > 0) {
                speed = Math.round(bytesDownloaded / elapsedSeconds);
                const remainingBytes = totalSize - bytesDownloaded;
                eta = speed > 0 ? Math.round(remainingBytes / speed) : null;
              }
            }
          } else if (downloadClient === 'qbittorrent' || (!downloadClient && clientType === 'qbittorrent')) {
            // Get torrent hash from download history
            const torrentHash = downloadHistory?.torrentHash;
            if (torrentHash) {
              const qbService = await getQBittorrentService();
              const torrentInfo = await qbService.getTorrent(torrentHash);
              speed = torrentInfo.dlspeed;
              eta = torrentInfo.eta > 0 ? torrentInfo.eta : null;
            }
          } else if (downloadClient === 'sabnzbd' || (!downloadClient && clientType === 'sabnzbd')) {
            // Get NZB ID from download history
            const nzbId = downloadHistory?.nzbId;
            if (nzbId) {
              const sabnzbdService = await getSABnzbdService();
              const nzbInfo = await sabnzbdService.getNZB(nzbId);
              if (nzbInfo) {
                speed = nzbInfo.downloadSpeed;
                eta = nzbInfo.timeLeft > 0 ? nzbInfo.timeLeft : null;
              }
            }
          }
        } catch (error) {
          // Download client unavailable or download not found - use defaults
          logger.error('Failed to get download info', { error: error instanceof Error ? error.message : String(error) });
        }

        return {
          requestId: download.id,
          title: download.audiobook.title,
          author: download.audiobook.author,
          status: download.status,
          type: download.type, // 'audiobook' or 'ebook'
          progress: download.progress,
          speed,
          eta,
          torrentName: downloadHistory?.torrentName || null,
          downloadStatus: downloadHistory?.downloadStatus || null,
          user: download.user.plexUsername,
          startedAt: downloadHistory?.startedAt || downloadHistory?.createdAt || download.updatedAt,
        };
      })
    );

    return NextResponse.json({ downloads: formatted });
      } catch (error) {
        logger.error('Failed to fetch active downloads', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch active downloads' },
          { status: 500 }
        );
      }
    });
  });
}
