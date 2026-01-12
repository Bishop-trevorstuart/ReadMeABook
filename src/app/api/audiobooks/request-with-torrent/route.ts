/**
 * Component: Request with Specific Torrent API
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Create a request and immediately download a specific torrent
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.RequestWithTorrent');

const RequestWithTorrentSchema = z.object({
  audiobook: z.object({
    asin: z.string(),
    title: z.string(),
    author: z.string(),
    narrator: z.string().optional(),
    description: z.string().optional(),
    coverArtUrl: z.string().optional(),
    durationMinutes: z.number().optional(),
    releaseDate: z.string().optional(),
    rating: z.number().nullable().optional(),
  }),
  torrent: z.object({
    guid: z.string(),
    title: z.string(),
    size: z.number(),
    seeders: z.number().optional(), // Optional for NZB/Usenet results
    leechers: z.number().optional(), // Optional for NZB/Usenet results
    indexer: z.string(),
    downloadUrl: z.string(),
    publishDate: z.string().transform((str) => new Date(str)),
    infoHash: z.string().optional(),
    format: z.enum(['M4B', 'M4A', 'MP3', 'OTHER']).optional(),
    bitrate: z.string().optional(),
    hasChapters: z.boolean().optional(),
  }),
});

/**
 * POST /api/audiobooks/request-with-torrent
 * Create a request and download a specific torrent in one operation
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const body = await req.json();
      const { audiobook, torrent } = RequestWithTorrentSchema.parse(body);

      // First check: Is there an existing request in 'downloaded' or 'available' status?
      // This catches the gap where files are organized but Plex hasn't scanned yet
      const existingActiveRequest = await prisma.request.findFirst({
        where: {
          audiobook: {
            audibleAsin: audiobook.asin,
          },
          status: { in: ['downloaded', 'available'] },
          deletedAt: null,
        },
        include: {
          user: { select: { plexUsername: true } },
        },
      });

      if (existingActiveRequest) {
        const status = existingActiveRequest.status;
        const isOwnRequest = existingActiveRequest.userId === req.user.id;

        return NextResponse.json(
          {
            error: status === 'available' ? 'AlreadyAvailable' : 'BeingProcessed',
            message: status === 'available'
              ? 'This audiobook is already available in your Plex library'
              : 'This audiobook is being processed and will be available soon',
            requestStatus: status,
            isOwnRequest,
            requestedBy: existingActiveRequest.user?.plexUsername,
          },
          { status: 409 }
        );
      }

      // Second check: Is audiobook already in Plex library? (fallback for non-requested books)
      const plexMatch = await findPlexMatch({
        asin: audiobook.asin,
        title: audiobook.title,
        author: audiobook.author,
        narrator: audiobook.narrator,
      });

      if (plexMatch) {
        return NextResponse.json(
          {
            error: 'AlreadyAvailable',
            message: 'This audiobook is already available in your Plex library',
            plexGuid: plexMatch.plexGuid,
          },
          { status: 409 }
        );
      }

      // Try to find existing audiobook record by ASIN
      let audiobookRecord = await prisma.audiobook.findFirst({
        where: { audibleAsin: audiobook.asin },
      });

      // If not found, create new audiobook record
      if (!audiobookRecord) {
        audiobookRecord = await prisma.audiobook.create({
          data: {
            audibleAsin: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            status: 'requested',
          },
        });
      }

      // Check if user already has an active (non-deleted) request for this audiobook
      const existingRequest = await prisma.request.findFirst({
        where: {
          userId: req.user.id,
          audiobookId: audiobookRecord.id,
          deletedAt: null, // Only check active requests
        },
      });

      if (existingRequest) {
        const canReRequest = ['failed', 'warn', 'cancelled'].includes(existingRequest.status);

        if (!canReRequest) {
          return NextResponse.json(
            {
              error: 'DuplicateRequest',
              message: 'You have already requested this audiobook',
              request: existingRequest,
            },
            { status: 409 }
          );
        }

        // Delete the existing failed/warn/cancelled request
        logger.debug(`Deleting existing ${existingRequest.status} request ${existingRequest.id}`);
        await prisma.request.delete({
          where: { id: existingRequest.id },
        });
      }

      // Create request with downloading status
      const newRequest = await prisma.request.create({
        data: {
          userId: req.user.id,
          audiobookId: audiobookRecord.id,
          status: 'downloading',
          progress: 0,
        },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
        },
      });

      // Queue download job with the selected torrent
      const jobQueue = getJobQueueService();
      await jobQueue.addDownloadJob(
        newRequest.id,
        {
          id: audiobookRecord.id,
          title: audiobookRecord.title,
          author: audiobookRecord.author,
        },
        torrent
      );

      logger.info(`Queued download monitor job for request ${newRequest.id}`);

      return NextResponse.json({
        success: true,
        request: newRequest,
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to create request with torrent', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'ValidationError',
            details: error.errors,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: 'RequestError',
          message: error instanceof Error ? error.message : 'Failed to create request and download torrent',
        },
        { status: 500 }
      );
    }
  });
}
