/**
 * Component: Setup Wizard Test Download Client API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Setup.TestDownloadClient');

export async function POST(request: NextRequest) {
  try {
    const { type, url, username, password, disableSSLVerify } = await request.json();

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

    // Validate required fields per client type
    if (type === 'qbittorrent') {
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: 'Username and password are required for qBittorrent' },
          { status: 400 }
        );
      }

      // Test qBittorrent connection
      const version = await QBittorrentService.testConnectionWithCredentials(
        url,
        username,
        password,
        disableSSLVerify || false
      );

      return NextResponse.json({
        success: true,
        version,
      });
    } else if (type === 'sabnzbd') {
      if (!password) {
        return NextResponse.json(
          { success: false, error: 'API key (password) is required for SABnzbd' },
          { status: 400 }
        );
      }

      // Test SABnzbd connection
      const sabnzbd = new SABnzbdService(url, password, 'readmeabook', disableSSLVerify || false);
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

      return NextResponse.json({
        success: true,
        version: result.version,
      });
    }

    // Should never reach here
    return NextResponse.json(
      { success: false, error: 'Invalid client type' },
      { status: 400 }
    );
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
}
