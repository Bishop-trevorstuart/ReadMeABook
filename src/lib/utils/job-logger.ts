/**
 * Component: Job Logger Utility (Backward Compatibility)
 * Documentation: documentation/backend/services/jobs.md
 *
 * @deprecated Use RMABLogger.forJob() directly for new code.
 * This file provides backward compatibility for existing processors.
 *
 * Migration example:
 * ```typescript
 * // Before (deprecated)
 * const logger = jobId ? createJobLogger(jobId, 'Context') : null;
 * await logger?.info('message');
 *
 * // After (preferred)
 * import { RMABLogger } from './logger';
 * const logger = RMABLogger.forJob(jobId, 'Context');
 * logger.info('message'); // No await needed!
 * ```
 */

import { RMABLogger, LogMetadata } from './logger';

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * @deprecated Use RMABLogger.forJob() directly
 */
export class JobLogger {
  private logger: RMABLogger;

  constructor(jobId: string, context: string) {
    this.logger = RMABLogger.forJob(jobId, context);
  }

  /**
   * Log info message
   * @deprecated Returns Promise for backward compat but is actually synchronous
   */
  async info(message: string, metadata?: LogMetadata): Promise<void> {
    this.logger.info(message, metadata);
  }

  /**
   * Log warning message
   * @deprecated Returns Promise for backward compat but is actually synchronous
   */
  async warn(message: string, metadata?: LogMetadata): Promise<void> {
    this.logger.warn(message, metadata);
  }

  /**
   * Log error message
   * @deprecated Returns Promise for backward compat but is actually synchronous
   */
  async error(message: string, metadata?: LogMetadata): Promise<void> {
    this.logger.error(message, metadata);
  }
}

/**
 * Create a job logger instance
 * @deprecated Use RMABLogger.forJob() directly
 */
export function createJobLogger(jobId: string, context: string): JobLogger {
  return new JobLogger(jobId, context);
}
