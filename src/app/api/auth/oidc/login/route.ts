/**
 * OIDC Login Initiation Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { getAuthProvider } from '@/lib/services/auth';
import { getBaseUrl } from '@/lib/utils/url';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Auth.OIDC.Login');

export async function GET() {
  try {
    // Get OIDC auth provider
    const authProvider = await getAuthProvider('oidc');

    // Initiate login flow
    const { redirectUrl } = await authProvider.initiateLogin();

    if (!redirectUrl) {
      return NextResponse.json(
        { error: 'Failed to generate authorization URL' },
        { status: 500 }
      );
    }

    // Redirect to OIDC provider
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    logger.error('Failed to initiate login', { error: error instanceof Error ? error.message : String(error) });

    // Redirect to login page with error
    const baseUrl = getBaseUrl();
    const errorMessage = error instanceof Error ? error.message : 'Failed to initiate login';
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(errorMessage)}`);
  }
}
