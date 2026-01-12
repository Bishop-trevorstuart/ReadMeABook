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
        // Get active downloads with related data
    const activeDownloads = await prisma.request.findMany({
      where: {
        status: 'downloading',
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
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

        try {
          if (clientType === 'qbittorrent') {
            // Get torrent hash from download history
            const torrentHash = download.downloadHistory[0]?.torrentHash;
            if (torrentHash) {
              const qbService = await getQBittorrentService();
              const torrentInfo = await qbService.getTorrent(torrentHash);
              speed = torrentInfo.dlspeed;
              eta = torrentInfo.eta > 0 ? torrentInfo.eta : null;
            }
          } else if (clientType === 'sabnzbd') {
            // Get NZB ID from download history
            const nzbId = download.downloadHistory[0]?.nzbId;
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
          progress: download.progress,
          speed,
          eta,
          torrentName: download.downloadHistory[0]?.torrentName || null,
          downloadStatus: download.downloadHistory[0]?.downloadStatus || null,
          user: download.user.plexUsername,
          startedAt: download.downloadHistory[0]?.startedAt || download.downloadHistory[0]?.createdAt || download.updatedAt,
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
