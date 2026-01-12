/**
 * List Available Auth Providers
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { ConfigurationService } from '@/lib/services/config.service';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Auth.Providers');

export async function GET() {
  try {
    const configService = new ConfigurationService();
    const backendMode = await configService.get('system.backend_mode');

    // Check if local login is disabled via environment variable
    const localLoginDisabled = process.env.DISABLE_LOCAL_LOGIN === 'true';

    if (backendMode === 'audiobookshelf') {
      // Audiobookshelf mode - check which auth methods are enabled
      const oidcEnabled = (await configService.get('oidc.enabled')) === 'true';
      const registrationEnabled = (await configService.get('auth.registration_enabled')) === 'true';
      const oidcProviderName = await configService.get('oidc.provider_name') || 'SSO';

      // Check if any local users exist in database (for login form visibility)
      const hasLocalUsers = (await prisma.user.count({
        where: { authProvider: 'local' }
      })) > 0;

      const providers: string[] = [];
      if (oidcEnabled) providers.push('oidc');
      // Only add 'local' provider if not disabled and users exist
      if (hasLocalUsers && !localLoginDisabled) providers.push('local');

      return NextResponse.json({
        backendMode: 'audiobookshelf',
        providers,
        registrationEnabled: !localLoginDisabled && registrationEnabled,
        hasLocalUsers,
        oidcProviderName: oidcEnabled ? oidcProviderName : null,
        localLoginDisabled,
      });
    } else {
      // Plex mode - check if local admin exists (setup admin)
      const hasLocalUsers = (await prisma.user.count({
        where: {
          plexId: { startsWith: 'local-' },
          isSetupAdmin: true
        }
      })) > 0;

      return NextResponse.json({
        backendMode: 'plex',
        providers: ['plex'],
        registrationEnabled: false,
        hasLocalUsers,
        oidcProviderName: null,
        localLoginDisabled,
      });
    }
  } catch (error) {
    logger.error('Failed to fetch auth providers', { error: error instanceof Error ? error.message : String(error) });
    // Default to Plex mode if config can't be read
    const localLoginDisabled = process.env.DISABLE_LOCAL_LOGIN === 'true';
    return NextResponse.json({
      backendMode: 'plex',
      providers: ['plex'],
      registrationEnabled: false,
      hasLocalUsers: false,
      oidcProviderName: null,
      localLoginDisabled,
    });
  }
}
