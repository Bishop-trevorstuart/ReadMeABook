/**
 * Component: Admin Download Client Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { PathMapper } from '@/lib/utils/path-mapper';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const {
          type,
          url,
          username,
          password,
          remotePathMappingEnabled,
          remotePath,
          localPath,
        } = await request.json();

        if (!type || !url || !username || !password) {
          return NextResponse.json(
            { error: 'Type, URL, username, and password are required' },
            { status: 400 }
          );
        }

        // Validate type
        if (type !== 'qbittorrent' && type !== 'transmission') {
          return NextResponse.json(
            { error: 'Invalid client type. Must be qbittorrent or transmission' },
            { status: 400 }
          );
        }

        // Validate path mapping if enabled
        if (remotePathMappingEnabled) {
          if (!remotePath || !localPath) {
            return NextResponse.json(
              { error: 'Remote path and local path are required when path mapping is enabled' },
              { status: 400 }
            );
          }

          try {
            PathMapper.validate({
              enabled: true,
              remotePath,
              localPath,
            });
          } catch (validationError) {
            return NextResponse.json(
              {
                error: validationError instanceof Error
                  ? validationError.message
                  : 'Invalid path mapping configuration',
              },
              { status: 400 }
            );
          }
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: 'download_client_type' },
          update: { value: type },
          create: { key: 'download_client_type', value: type },
        });

        await prisma.configuration.upsert({
          where: { key: 'download_client_url' },
          update: { value: url },
          create: { key: 'download_client_url', value: url },
        });

        await prisma.configuration.upsert({
          where: { key: 'download_client_username' },
          update: { value: username },
          create: { key: 'download_client_username', value: username },
        });

        // Only update password if it's not the masked value
        if (!password.startsWith('••••')) {
          await prisma.configuration.upsert({
            where: { key: 'download_client_password' },
            update: { value: password },
            create: { key: 'download_client_password', value: password },
          });
        }

        // Save remote path mapping configuration
        await prisma.configuration.upsert({
          where: { key: 'download_client_remote_path_mapping_enabled' },
          update: { value: remotePathMappingEnabled ? 'true' : 'false' },
          create: {
            key: 'download_client_remote_path_mapping_enabled',
            value: remotePathMappingEnabled ? 'true' : 'false',
          },
        });

        await prisma.configuration.upsert({
          where: { key: 'download_client_remote_path' },
          update: { value: remotePath || '' },
          create: { key: 'download_client_remote_path', value: remotePath || '' },
        });

        await prisma.configuration.upsert({
          where: { key: 'download_client_local_path' },
          update: { value: localPath || '' },
          create: { key: 'download_client_local_path', value: localPath || '' },
        });

        console.log('[Admin] Download client settings updated');

        // Invalidate qBittorrent service singleton to force reload of credentials and URL
        const { invalidateQBittorrentService } = await import('@/lib/integrations/qbittorrent.service');
        invalidateQBittorrentService();

        return NextResponse.json({
          success: true,
          message: 'Download client settings updated successfully',
        });
      } catch (error) {
        console.error('[Admin] Failed to update download client settings:', error);
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
