/**
 * Component: Admin Prowlarr Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.Prowlarr');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, apiKey } = await request.json();

        if (!url || !apiKey) {
          return NextResponse.json(
            { error: 'URL and API key are required' },
            { status: 400 }
          );
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: 'prowlarr_url' },
          update: { value: url },
          create: { key: 'prowlarr_url', value: url },
        });

        // Only update API key if it's not the masked value
        if (!apiKey.startsWith('••••')) {
          await prisma.configuration.upsert({
            where: { key: 'prowlarr_api_key' },
            update: { value: apiKey },
            create: { key: 'prowlarr_api_key', value: apiKey },
          });
        }

        logger.info('Prowlarr settings updated');

        return NextResponse.json({
          success: true,
          message: 'Prowlarr settings updated successfully',
        });
      } catch (error) {
        logger.error('Failed to update Prowlarr settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update settings',
          },
          { status: 500 }
        );
      }
    });
  });
}
