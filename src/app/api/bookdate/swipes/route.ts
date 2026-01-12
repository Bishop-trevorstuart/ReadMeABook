/**
 * BookDate: Clear Swipe History (Admin Only)
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.BookDate.Swipes');

// DELETE: Clear all users' swipe history (Admin only)
async function clearSwipes(req: AuthenticatedRequest) {
  try {
    // Delete all swipes for ALL users (global admin action)
    await prisma.bookDateSwipe.deleteMany({});

    // Also clear all cached recommendations (since swipe history affects recommendations)
    await prisma.bookDateRecommendation.deleteMany({});

    logger.info('Admin cleared all swipe history and recommendations');

    return NextResponse.json({
      success: true,
      message: 'All swipe history cleared',
    });

  } catch (error: any) {
    logger.error('Clear swipes error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error.message || 'Failed to clear swipe history' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  return requireAuth(req, async (authReq) => requireAdmin(authReq, clearSwipes));
}
