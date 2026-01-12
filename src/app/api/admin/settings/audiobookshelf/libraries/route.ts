/**
 * Audiobookshelf Libraries API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.ABSLibraries');

export async function GET(request: NextRequest) {
  logger.debug('GET request received');
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    logger.debug('Auth passed', { user: req.user });
    return requireAdmin(req, async () => {
      logger.debug('Admin check passed');
      try {
        // Use getConfigService like Plex endpoint does
        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();
        const serverUrl = await configService.get('audiobookshelf.server_url');
        const apiToken = await configService.get('audiobookshelf.api_token');
        logger.debug('Config loaded', { hasServerUrl: !!serverUrl, hasApiToken: !!apiToken });

        if (!serverUrl || !apiToken) {
          return NextResponse.json(
            { error: 'Audiobookshelf not configured' },
            { status: 400 }
          );
        }

        // Fetch libraries from Audiobookshelf
        const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/libraries`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
          },
        });

        if (!response.ok) {
          return NextResponse.json(
            { error: 'Failed to fetch libraries from Audiobookshelf' },
            { status: response.status }
          );
        }

        const data = await response.json();

        // Filter to only audiobook libraries and map to expected format
        const libraries = (data.libraries || [])
          .filter((lib: any) => lib.mediaType === 'book')
          .map((lib: any) => ({
            id: lib.id,
            name: lib.name,
            type: lib.mediaType,
            itemCount: lib.stats?.totalItems || 0,
          }));

        return NextResponse.json({ libraries });
      } catch (error) {
        logger.error('Failed to fetch ABS libraries', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch libraries' },
          { status: 500 }
        );
      }
    });
  });
}
