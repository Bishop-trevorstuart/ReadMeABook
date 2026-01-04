/**
 * Component: Admin Active Downloads API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getQBittorrentService } from '@/lib/integrations/qbittorrent.service';

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

    // Get qBittorrent service
    let qbService;
    try {
      qbService = await getQBittorrentService();
    } catch (error) {
      console.error('[Admin] Failed to initialize qBittorrent service:', error);
      // Return downloads without speed/eta if qBittorrent is unavailable
      const formatted = activeDownloads.map((download) => ({
        requestId: download.id,
        title: download.audiobook.title,
        author: download.audiobook.author,
        status: download.status,
        progress: download.progress,
        speed: 0,
        eta: null,
        torrentName: download.downloadHistory[0]?.torrentName || null,
        downloadStatus: download.downloadHistory[0]?.downloadStatus || null,
        user: download.user.plexUsername,
        startedAt: download.downloadHistory[0]?.startedAt || download.downloadHistory[0]?.createdAt || download.updatedAt,
      }));
      return NextResponse.json({ downloads: formatted });
    }

    // Format response with speed and ETA from qBittorrent
    const formatted = await Promise.all(
      activeDownloads.map(async (download) => {
        let speed = 0;
        let eta: number | null = null;

        // Get torrent hash from download history
        const torrentHash = download.downloadHistory[0]?.torrentHash;

        // Fetch torrent info from qBittorrent if we have a hash
        if (torrentHash) {
          try {
            const torrentInfo = await qbService.getTorrent(torrentHash);
            speed = torrentInfo.dlspeed;
            eta = torrentInfo.eta > 0 ? torrentInfo.eta : null;
          } catch (error) {
            // Torrent not found or other error - use defaults
            console.error(`[Admin] Failed to get torrent info for ${torrentHash}:`, error);
          }
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
        console.error('[Admin] Failed to fetch active downloads:', error);
        return NextResponse.json(
          { error: 'Failed to fetch active downloads' },
          { status: 500 }
        );
      }
    });
  });
}
