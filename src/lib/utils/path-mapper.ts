/**
 * Path Mapper Utility
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * Handles remote-to-local path mapping for qBittorrent downloads.
 * Use case: qBittorrent on remote seedbox or different mount points.
 */

import path from 'path';

export interface PathMappingConfig {
  enabled: boolean;
  remotePath: string;
  localPath: string;
}

export class PathMapper {
  /**
   * Transforms a qBittorrent path using remote-to-local mapping
   *
   * Example:
   *   qBittorrent reports: /remote/mnt/d/done/Audiobook.Name
   *   Config: { enabled: true, remotePath: '/remote/mnt/d/done', localPath: '/downloads' }
   *   Returns: /downloads/Audiobook.Name
   *
   * @param qbittorrentPath - Path reported by qBittorrent
   * @param config - Path mapping configuration
   * @returns Transformed path (or original if mapping disabled/no match)
   */
  static transform(qbittorrentPath: string, config: PathMappingConfig): string {
    // 1. If mapping disabled, return original
    if (!config.enabled) {
      return qbittorrentPath;
    }

    // 2. Handle empty paths
    if (!qbittorrentPath || !config.remotePath || !config.localPath) {
      console.warn('PathMapper: Empty path or config, returning original');
      return qbittorrentPath;
    }

    // 3. Normalize paths (handle trailing slashes, backslashes)
    // Convert all backslashes to forward slashes for consistency
    const normalizedRemote = this.normalizePath(config.remotePath);
    const normalizedLocal = this.normalizePath(config.localPath);
    const normalizedQbPath = this.normalizePath(qbittorrentPath);

    // 4. Check if qBittorrent path starts with remote path
    if (!normalizedQbPath.startsWith(normalizedRemote)) {
      console.warn(
        `PathMapper: Path "${qbittorrentPath}" does not start with remote path "${config.remotePath}". ` +
        `Returning original path unchanged.`
      );
      return qbittorrentPath;
    }

    // 5. Replace remote prefix with local prefix
    const relativePath = normalizedQbPath.substring(normalizedRemote.length);

    // Join local path with relative path, ensuring proper path separators
    const transformedPath = path.join(normalizedLocal, relativePath);

    console.log(`PathMapper: Transformed "${qbittorrentPath}" → "${transformedPath}"`);
    return transformedPath;
  }

  /**
   * Validates path mapping configuration
   *
   * @param config - Path mapping configuration to validate
   * @throws Error if paths are invalid (empty, malformed, etc.)
   */
  static validate(config: PathMappingConfig): void {
    if (!config.enabled) {
      return; // No validation needed if disabled
    }

    if (!config.remotePath || config.remotePath.trim() === '') {
      throw new Error('Remote path cannot be empty when path mapping is enabled');
    }

    if (!config.localPath || config.localPath.trim() === '') {
      throw new Error('Local path cannot be empty when path mapping is enabled');
    }

    // Check for obviously invalid paths
    const invalidChars = /[<>"|?*]/;
    if (invalidChars.test(config.remotePath)) {
      throw new Error('Remote path contains invalid characters');
    }

    if (invalidChars.test(config.localPath)) {
      throw new Error('Local path contains invalid characters');
    }

    // Warn if paths look suspicious (but don't throw)
    if (config.remotePath === config.localPath) {
      console.warn('PathMapper: Remote and local paths are identical - path mapping will have no effect');
    }
  }

  /**
   * Normalizes a file path for consistent comparison
   * - Converts backslashes to forward slashes
   * - Removes trailing slashes
   * - Normalizes redundant separators
   *
   * @param filePath - Path to normalize
   * @returns Normalized path
   */
  private static normalizePath(filePath: string): string {
    // Convert backslashes to forward slashes
    let normalized = filePath.replace(/\\/g, '/');

    // Use path.normalize to handle redundant separators and ..
    normalized = path.normalize(normalized);

    // Convert backslashes again (path.normalize might add them on Windows)
    normalized = normalized.replace(/\\/g, '/');

    // Remove trailing slash (except for root '/')
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }
}
