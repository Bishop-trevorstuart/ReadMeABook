/**
 * Component: Admin Download Client Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { PathMapper } from '@/lib/utils/path-mapper';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.DownloadClient');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const {
          type,
          url,
          username,
          password,
          disableSSLVerify,
          remotePathMappingEnabled,
          remotePath,
          localPath,
        } = await request.json();

        // Validate type
        if (type !== 'qbittorrent' && type !== 'sabnzbd') {
          return NextResponse.json(
            { error: 'Invalid client type. Must be qbittorrent or sabnzbd' },
            { status: 400 }
          );
        }

        // Validate required fields (SABnzbd only needs URL and API key)
        if (type === 'sabnzbd') {
          if (!url || !password) {
            return NextResponse.json(
              { error: 'URL and API key (password) are required for SABnzbd' },
              { status: 400 }
            );
          }
        } else if (type === 'qbittorrent') {
          if (!url || !username || !password) {
            return NextResponse.json(
              { error: 'URL, username, and password are required for qBittorrent' },
              { status: 400 }
            );
          }
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

        // Save SSL verification setting
        await prisma.configuration.upsert({
          where: { key: 'download_client_disable_ssl_verify' },
          update: { value: disableSSLVerify ? 'true' : 'false' },
          create: {
            key: 'download_client_disable_ssl_verify',
            value: disableSSLVerify ? 'true' : 'false',
          },
        });

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

        logger.info('Download client settings updated');

        // Invalidate download client service singleton to force reload of credentials and URL
        if (type === 'qbittorrent') {
          const { invalidateQBittorrentService } = await import('@/lib/integrations/qbittorrent.service');
          invalidateQBittorrentService();
        } else if (type === 'sabnzbd') {
          const { invalidateSABnzbdService } = await import('@/lib/integrations/sabnzbd.service');
          invalidateSABnzbdService();
        }

        return NextResponse.json({
          success: true,
          message: 'Download client settings updated successfully',
        });
      } catch (error) {
        logger.error('Failed to update download client settings', { error: error instanceof Error ? error.message : String(error) });
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
