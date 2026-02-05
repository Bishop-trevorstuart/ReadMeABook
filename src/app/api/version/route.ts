/**
 * Component: Version API Route
 * Documentation: documentation/backend/services/version.md
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const appVersion = process.env.APP_VERSION || 'unknown';
  const gitCommit = process.env.GIT_COMMIT || 'unknown';
  const buildDate = process.env.BUILD_DATE || 'unknown';

  return NextResponse.json({
    version: appVersion !== 'unknown' ? `v${appVersion}` : 'vDEV',
    fullVersion: appVersion,
    commit: gitCommit,
    buildDate,
  });
}
