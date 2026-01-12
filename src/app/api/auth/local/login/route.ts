/**
 * Local Login Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { LocalAuthProvider } from '@/lib/services/auth/LocalAuthProvider';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Auth.LocalLogin');

export async function POST(request: NextRequest) {
  try {
    // Check if local login is disabled
    if (process.env.DISABLE_LOCAL_LOGIN === 'true') {
      return NextResponse.json(
        { error: 'Local login is disabled' },
        { status: 403 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    logger.info('Attempting login', { username });

    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username, password });

    if (!result.success) {
      if (result.requiresApproval) {
        logger.info('Account pending approval', { username });
        return NextResponse.json({
          success: false,
          pendingApproval: true,
          message: 'Account pending admin approval.',
        });
      }
      logger.error('Login failed', { error: result.error });
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    logger.info('Login successful', { username });
    logger.debug('User data', { user: result.user });
    logger.debug('Token generated successfully');

    // Return tokens for login
    return NextResponse.json({
      success: true,
      user: result.user,
      accessToken: result.tokens!.accessToken,
      refreshToken: result.tokens!.refreshToken,
    });
  } catch (error) {
    logger.error('Error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
