/**
 * Component: Version Badge
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useEffect, useState } from 'react';

export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);
  const [commit, setCommit] = useState<string | null>(null);

  useEffect(() => {
    // Try to get version from build-time env var first (instant, no API call)
    const buildTimeVersion = process.env.NEXT_PUBLIC_APP_VERSION;

    if (buildTimeVersion && buildTimeVersion !== 'unknown') {
      setVersion(`v${buildTimeVersion}`);
      // Also get commit for tooltip if available
      const buildTimeCommit = process.env.NEXT_PUBLIC_GIT_COMMIT;
      if (buildTimeCommit && buildTimeCommit !== 'unknown') {
        const shortCommit = buildTimeCommit.length >= 7
          ? buildTimeCommit.substring(0, 7)
          : buildTimeCommit;
        setCommit(shortCommit);
      }
    } else {
      // Fallback to API call if build-time env var is not available
      fetch('/api/version')
        .then((res) => res.json())
        .then((data) => {
          setVersion(data.version);
          if (data.commit && data.commit !== 'unknown') {
            setCommit(data.commit.substring(0, 7));
          }
        })
        .catch((error) => {
          console.error('Failed to fetch version:', error);
          setVersion('vDEV');
        });
    }
  }, []);

  if (!version) {
    return null;
  }

  const tooltipText = commit ? `${version} (${commit})` : version;

  return (
    <div
      className="inline-flex items-center px-2.5 py-1 rounded-md bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 border border-gray-300 dark:border-gray-600 shadow-sm"
      title={tooltipText}
    >
      <span className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300">
        {version}
      </span>
    </div>
  );
}
