/**
 * Component: Admin Settings Test Download Client API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.TestDownloadClient');

export async function POST(request: NextRequest) {
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

        logger.debug('Received request', { type, url, hasUsername: !!username, hasPassword: !!password });

        if (!type || !url) {
          return NextResponse.json(
            { success: false, error: 'Type and URL are required' },
            { status: 400 }
          );
        }

        if (type !== 'qbittorrent' && type !== 'sabnzbd') {
          return NextResponse.json(
            { success: false, error: 'Invalid client type. Must be qbittorrent or sabnzbd' },
            { status: 400 }
          );
        }

        // If password is masked, fetch the actual value from database
        let actualPassword = password;
        if (password && password.startsWith('••••')) {
          const storedPassword = await prisma.configuration.findUnique({
            where: { key: 'download_client_password' },
          });

          if (!storedPassword?.value) {
            return NextResponse.json(
              { success: false, error: 'No stored password/API key found. Please re-enter it.' },
              { status: 400 }
            );
          }

          actualPassword = storedPassword.value;
        }

        // Validate required fields per client type and test connection
        let version: string | undefined;

        if (type === 'qbittorrent') {
          logger.debug('Testing qBittorrent connection');
          if (!username || !actualPassword) {
            return NextResponse.json(
              { success: false, error: 'Username and password are required for qBittorrent' },
              { status: 400 }
            );
          }

          // Test qBittorrent connection
          version = await QBittorrentService.testConnectionWithCredentials(
            url,
            username,
            actualPassword,
            disableSSLVerify || false
          );
        } else if (type === 'sabnzbd') {
          logger.debug('Testing SABnzbd connection');
          if (!actualPassword) {
            return NextResponse.json(
              { success: false, error: 'API key (password) is required for SABnzbd' },
              { status: 400 }
            );
          }

          // Test SABnzbd connection
          const sabnzbd = new SABnzbdService(url, actualPassword, 'readmeabook', disableSSLVerify || false);
          const result = await sabnzbd.testConnection();

          if (!result.success) {
            return NextResponse.json(
              {
                success: false,
                error: result.error || 'Failed to connect to SABnzbd',
              },
              { status: 500 }
            );
          }

          version = result.version;
        }

        // If path mapping enabled, validate local path exists
        if (remotePathMappingEnabled) {
          if (!remotePath || !localPath) {
            return NextResponse.json(
              {
                success: false,
                error: 'Remote path and local path are required when path mapping is enabled',
              },
              { status: 400 }
            );
          }

          // Check if local path is accessible
          const fs = await import('fs/promises');
          try {
            await fs.access(localPath, fs.constants.R_OK);
          } catch (accessError) {
            return NextResponse.json(
              {
                success: false,
                error: `Local path "${localPath}" is not accessible. Please verify the path exists and has correct permissions.`,
              },
              { status: 400 }
            );
          }
        }

        return NextResponse.json({
          success: true,
          version,
        });
      } catch (error) {
        logger.error('Download client test failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to connect to download client',
          },
          { status: 500 }
        );
      }
    });
  });
}
