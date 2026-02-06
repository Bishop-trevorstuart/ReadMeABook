/**
 * Component: FlareSolverr Connection Test API
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { testFlareSolverrConnection } from '@/lib/services/ebook-scraper';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.TestFlareSolverr');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, baseUrl } = await request.json();

        if (!url) {
          return NextResponse.json(
            { error: 'FlareSolverr URL is required' },
            { status: 400 }
          );
        }

        if (!url.startsWith('http')) {
          return NextResponse.json(
            { error: 'URL must start with http:// or https://' },
            { status: 400 }
          );
        }

        const result = await testFlareSolverrConnection(url, baseUrl);

        return NextResponse.json(result);
      } catch (error) {
        logger.error('FlareSolverr test failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });
  });
}
