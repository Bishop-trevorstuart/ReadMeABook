/**
 * Component: Admin Recent Requests API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Requests.Recent');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Get recent requests (only active, non-deleted)
    const recentRequests = await prisma.request.findMany({
      where: {
        deletedAt: null,
      },
      include: {
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
            selected: true,
          },
          select: {
            torrentUrl: true,
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    // Format response
    const formatted = recentRequests.map((request) => ({
      requestId: request.id,
      title: request.audiobook.title,
      author: request.audiobook.author,
      status: request.status,
      user: request.user.plexUsername,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
      errorMessage: request.errorMessage,
      torrentUrl: request.downloadHistory[0]?.torrentUrl || null,
    }));

    return NextResponse.json({ requests: formatted });
      } catch (error) {
        logger.error('Failed to fetch recent requests', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch recent requests' },
          { status: 500 }
        );
      }
    });
  });
}
