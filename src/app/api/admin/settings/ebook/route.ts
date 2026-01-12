/**
 * Component: E-book Sidecar Settings API
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.Ebook');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Parse request body
        const { enabled, format, baseUrl, flaresolverrUrl } = await request.json();

        // Validate format
        const validFormats = ['epub', 'pdf', 'mobi', 'azw3', 'any'];
        if (format && !validFormats.includes(format)) {
          return NextResponse.json(
            { error: `Invalid format. Must be one of: ${validFormats.join(', ')}` },
            { status: 400 }
          );
        }

        // Validate baseUrl (basic check)
        if (baseUrl && !baseUrl.startsWith('http')) {
          return NextResponse.json(
            { error: 'Base URL must start with http:// or https://' },
            { status: 400 }
          );
        }

        // Validate flaresolverrUrl if provided
        if (flaresolverrUrl && !flaresolverrUrl.startsWith('http')) {
          return NextResponse.json(
            { error: 'FlareSolverr URL must start with http:// or https://' },
            { status: 400 }
          );
        }

        // Save configuration
        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        const configs = [
          {
            key: 'ebook_sidecar_enabled',
            value: enabled ? 'true' : 'false',
            category: 'ebook',
            description: 'Enable e-book sidecar downloads from Annas Archive',
          },
          {
            key: 'ebook_sidecar_preferred_format',
            value: format || 'epub',
            category: 'ebook',
            description: 'Preferred e-book format',
          },
          {
            key: 'ebook_sidecar_base_url',
            value: baseUrl || 'https://annas-archive.li',
            category: 'ebook',
            description: 'Base URL for Annas Archive',
          },
          {
            key: 'ebook_sidecar_flaresolverr_url',
            value: flaresolverrUrl || '',
            category: 'ebook',
            description: 'FlareSolverr URL for bypassing Cloudflare protection',
          },
        ];

        await configService.setMany(configs);

        return NextResponse.json({ success: true });
      } catch (error) {
        logger.error('Failed to save e-book settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
