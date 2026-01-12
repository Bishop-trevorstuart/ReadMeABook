/**
 * Component: Fetch E-book API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Triggers e-book download for a completed request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { downloadEbook } from '@/lib/services/ebook-scraper';
import fs from 'fs/promises';
import path from 'path';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.FetchEbook');

/**
 * Sanitize path component (same logic as file-organizer)
 */
function sanitizePath(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '')
      .trim()
      .replace(/^\.+/, '')
      .replace(/\.+$/, '')
      .replace(/\s+/g, ' ')
      .slice(0, 200)
  );
}

/**
 * Build target path (same logic as file-organizer)
 */
function buildTargetPath(
  baseDir: string,
  author: string,
  title: string,
  year?: number | null,
  asin?: string | null
): string {
  const authorClean = sanitizePath(author);
  const titleClean = sanitizePath(title);

  let folderName = titleClean;

  if (year) {
    folderName = `${folderName} (${year})`;
  }

  if (asin) {
    folderName = `${folderName} ${asin}`;
  }

  return path.join(baseDir, authorClean, folderName);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;

        // Check if e-book sidecar is enabled
        const ebookEnabledConfig = await prisma.configuration.findUnique({
          where: { key: 'ebook_sidecar_enabled' },
        });

        if (ebookEnabledConfig?.value !== 'true') {
          return NextResponse.json(
            { error: 'E-book sidecar feature is not enabled' },
            { status: 400 }
          );
        }

        // Get the request with audiobook data
        const requestRecord = await prisma.request.findUnique({
          where: { id },
          include: {
            audiobook: true,
          },
        });

        if (!requestRecord) {
          return NextResponse.json(
            { error: 'Request not found' },
            { status: 404 }
          );
        }

        // Check if request is in completed state
        if (!['downloaded', 'available'].includes(requestRecord.status)) {
          return NextResponse.json(
            { error: `Cannot fetch e-book for request in ${requestRecord.status} status` },
            { status: 400 }
          );
        }

        const audiobook = requestRecord.audiobook;

        // Get configuration
        const [mediaDirConfig, formatConfig, baseUrlConfig, flaresolverrConfig] = await Promise.all([
          prisma.configuration.findUnique({ where: { key: 'media_dir' } }),
          prisma.configuration.findUnique({ where: { key: 'ebook_sidecar_preferred_format' } }),
          prisma.configuration.findUnique({ where: { key: 'ebook_sidecar_base_url' } }),
          prisma.configuration.findUnique({ where: { key: 'ebook_sidecar_flaresolverr_url' } }),
        ]);

        const mediaDir = mediaDirConfig?.value || '/media/audiobooks';
        const preferredFormat = formatConfig?.value || 'epub';
        const baseUrl = baseUrlConfig?.value || 'https://annas-archive.li';
        const flaresolverrUrl = flaresolverrConfig?.value || undefined;

        // Get year from AudibleCache if available
        let year: number | undefined;
        if (audiobook.audibleAsin) {
          const audibleCacheData = await prisma.audibleCache.findUnique({
            where: { asin: audiobook.audibleAsin },
            select: { releaseDate: true },
          });
          if (audibleCacheData?.releaseDate) {
            year = new Date(audibleCacheData.releaseDate).getFullYear();
          }
        }

        // Build target path
        const targetPath = buildTargetPath(
          mediaDir,
          audiobook.author,
          audiobook.title,
          year,
          audiobook.audibleAsin
        );

        logger.debug('Fetch e-book request', {
          requestId: id,
          title: audiobook.title,
          author: audiobook.author,
          targetPath,
          format: preferredFormat,
          baseUrl,
          flaresolverr: flaresolverrUrl || 'none'
        });

        // Check if target directory exists
        try {
          await fs.access(targetPath);
        } catch {
          logger.debug(`Target directory not found: ${targetPath}`);
          return NextResponse.json(
            { error: 'Audiobook directory not found. Was the audiobook properly organized?' },
            { status: 400 }
          );
        }

        // Download e-book
        const result = await downloadEbook(
          audiobook.audibleAsin || '',
          audiobook.title,
          audiobook.author,
          targetPath,
          preferredFormat,
          baseUrl,
          undefined, // No logger in API context
          flaresolverrUrl
        );

        if (result.success) {
          logger.info(`E-book downloaded: ${result.filePath ? path.basename(result.filePath) : 'unknown'} for "${audiobook.title}"`);
          return NextResponse.json({
            success: true,
            message: `E-book downloaded: ${result.filePath ? path.basename(result.filePath) : 'unknown'}`,
            format: result.format,
          });
        } else {
          logger.warn(`E-book download failed for "${audiobook.title}"`, { error: result.error });
          return NextResponse.json({
            success: false,
            message: result.error || 'E-book download failed',
          });
        }
      } catch (error) {
        logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Internal server error' },
          { status: 500 }
        );
      }
    });
  });
}
