/**
 * Component: Centralized Logging System (RMABLogger)
 * Documentation: documentation/backend/services/logging.md
 *
 * Single logging infrastructure for all console and database logging.
 * All logs in the application should go through RMABLogger.
 */

import { prisma } from '../db';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'quiet';

export interface LogMetadata {
  [key: string]: unknown;
}

// Log level hierarchy (lower number = more verbose)
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  quiet: 4,
};

/**
 * Get configured log level from environment (single source of truth)
 */
function getConfiguredLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return 'info'; // Default
}

// Cached log level (computed once at module load)
const CONFIGURED_LOG_LEVEL = getConfiguredLogLevel();
const CONFIGURED_LOG_PRIORITY = LEVEL_PRIORITY[CONFIGURED_LOG_LEVEL];

/**
 * RMABLogger - Centralized Logger for ReadMeABook
 *
 * Features:
 * - Context namespacing (e.g., RMABLogger.create('QBittorrent'))
 * - Job-aware database persistence (e.g., RMABLogger.forJob(jobId, 'Context'))
 * - Single LOG_LEVEL env var check point
 * - Consistent formatting: [LEVEL] [Context] Message
 * - Synchronous API - no await needed
 *
 * Usage:
 * ```typescript
 * // Standard logging
 * const logger = RMABLogger.create('QBittorrent');
 * logger.info('Connected successfully');
 * logger.debug('Cookie value', { cookie: '...' });
 *
 * // Job-aware logging (persists to database)
 * const logger = RMABLogger.forJob(jobId, 'SearchIndexers');
 * logger.info('Processing request'); // Logs to console AND database
 * ```
 */
export class RMABLogger {
  private context: string;
  private jobId: string | undefined;

  private constructor(context: string, jobId?: string) {
    this.context = context;
    this.jobId = jobId;
  }

  /**
   * Create a new logger with context namespace
   * @param context - Logger context (e.g., 'QBittorrent', 'Plex', 'API.Auth')
   */
  static create(context: string): RMABLogger {
    return new RMABLogger(context);
  }

  /**
   * Create a job-aware logger that persists to database
   * @param jobId - Job ID for database persistence (if undefined, logs to console only)
   * @param context - Logger context (e.g., 'SearchIndexers', 'MonitorDownload')
   */
  static forJob(jobId: string | undefined, context: string): RMABLogger {
    return new RMABLogger(context, jobId);
  }

  /**
   * Create a child logger with extended context
   * @param subContext - Additional context to append
   */
  child(subContext: string): RMABLogger {
    return new RMABLogger(`${this.context}.${subContext}`, this.jobId);
  }

  /**
   * Debug level logging (most verbose)
   * Only logged when LOG_LEVEL=debug
   * Never persisted to database
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.log('debug', message, metadata);
  }

  /**
   * Info level logging (default level)
   * Logged unless LOG_LEVEL=warn, error, or quiet
   */
  info(message: string, metadata?: LogMetadata): void {
    this.log('info', message, metadata);
  }

  /**
   * Warning level logging
   * Logged unless LOG_LEVEL=error or quiet
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.log('warn', message, metadata);
  }

  /**
   * Error level logging
   * Always logged unless LOG_LEVEL=quiet
   */
  error(message: string, metadata?: LogMetadata): void {
    this.log('error', message, metadata);
  }

  /**
   * Internal logging method - single point of LOG_LEVEL checking
   */
  private log(
    level: Exclude<LogLevel, 'quiet'>,
    message: string,
    metadata?: LogMetadata
  ): void {
    const levelPriority = LEVEL_PRIORITY[level];

    // Check if this level should be logged (single check point)
    if (levelPriority < CONFIGURED_LOG_PRIORITY) {
      return;
    }

    // Format: [LEVEL] [Context] Message
    const formattedMessage = `[${level.toUpperCase()}] [${this.context}] ${message}`;

    // Console output using appropriate method
    switch (level) {
      case 'debug':
        console.debug(formattedMessage);
        break;
      case 'info':
        console.log(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'error':
        console.error(formattedMessage);
        break;
    }

    // Log metadata if provided
    if (metadata && Object.keys(metadata).length > 0) {
      console.log(JSON.stringify(metadata, null, 2));
    }

    // Persist to database for job-aware loggers (fire-and-forget)
    // Debug logs are NEVER persisted to keep job_events clean
    if (this.jobId && level !== 'debug') {
      this.persistToDatabase(level, message, metadata);
    }
  }

  /**
   * Persist log to database (non-blocking, fire-and-forget)
   * Errors are silently caught - logging should never break job execution
   */
  private persistToDatabase(
    level: Exclude<LogLevel, 'quiet' | 'debug'>,
    message: string,
    metadata?: LogMetadata
  ): void {
    prisma.jobEvent
      .create({
        data: {
          jobId: this.jobId!,
          level,
          context: this.context,
          message,
          metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
        },
      })
      .catch(() => {
        // Silently fail - logging should never break job execution
      });
  }
}

/**
 * Convenience function to get the current log level
 */
export function getLogLevel(): LogLevel {
  return CONFIGURED_LOG_LEVEL;
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return CONFIGURED_LOG_LEVEL === 'debug';
}
