/**
 * Component: Setup Status Check API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Setup.Status');

/**
 * GET /api/setup/status
 * Returns whether initial setup has been completed
 * Used by middleware for routing logic
 */
export async function GET(request: NextRequest) {
  try {
    const config = await prisma.configuration.findUnique({
      where: { key: 'setup_completed' },
    });

    const setupComplete = config?.value === 'true';

    return NextResponse.json({
      setupComplete,
    });
  } catch (error) {
    // If database is not ready or table doesn't exist, setup is not complete
    logger.error('Check failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({
      setupComplete: false,
    });
  }
}
