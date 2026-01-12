# Centralized Logging (RMABLogger)

**Status:** Implemented | Unified logging with LOG_LEVEL filtering + job database persistence

## Overview

Single logging infrastructure for all backend services. Replaces scattered console statements with centralized logger that respects LOG_LEVEL env var and persists job-aware logs to database.

## Key Details

### Usage Patterns

**Standard logging (no job association):**
```typescript
import { RMABLogger } from '../utils/logger';

const logger = RMABLogger.create('ServiceName');
logger.info('Operation started');
logger.debug('Detailed info', { key: 'value' });
logger.warn('Potential issue');
logger.error('Failed operation', { error: err.message });
```

**Job-aware logging (persists to database):**
```typescript
const logger = RMABLogger.forJob(jobId, 'ProcessorName');
logger.info('Processing...'); // Logs to console AND database
logger.debug('Debug info');   // Console only (never persisted)
```

### LOG_LEVEL Configuration

| Value | Logs Shown |
|-------|------------|
| `debug` | All (debug + info + warn + error) |
| `info` | Default (info + warn + error) |
| `warn` | warn + error only |
| `error` | error only |
| `quiet` | None (DB logging still works for job-aware) |

### Output Format
```
[LEVEL] [Context] Message
```

Example:
```
[INFO] [QBittorrent] Connected successfully
[DEBUG] [SearchIndexers] Found 15 results
[WARN] [MonitorDownload] Torrent stalled, retrying
[ERROR] [OrganizeFiles] Failed to move file
```

## API

### Factory Methods

| Method | Description |
|--------|-------------|
| `RMABLogger.create(context)` | Standard logger for context namespace |
| `RMABLogger.forJob(jobId, context)` | Job-aware logger with DB persistence |

### Log Methods

| Method | Description |
|--------|-------------|
| `.debug(msg, metadata?)` | Verbose debugging (console only, never DB) |
| `.info(msg, metadata?)` | Normal operations |
| `.warn(msg, metadata?)` | Warnings |
| `.error(msg, metadata?)` | Errors |

### Child Loggers

```typescript
const logger = RMABLogger.create('Parent');
const child = logger.child('SubContext');
// Output: [INFO] [Parent.SubContext] Message
```

## Database Persistence

Job-aware loggers persist to `job_events` table:
- `jobId` - Associated job ID
- `level` - info, warn, error (never debug)
- `context` - Logger context
- `message` - Log message
- `metadata` - JSON metadata (optional)
- `createdAt` - Timestamp

**Note:** Debug logs are NEVER persisted to keep job_events clean.

## Files

- **Core:** `src/lib/utils/logger.ts`
- **Backward compat:** `src/lib/utils/job-logger.ts` (deprecated wrapper)

## Context Naming Conventions

| Component Type | Pattern | Example |
|----------------|---------|---------|
| Integration | Service name | `QBittorrent`, `Plex`, `Prowlarr` |
| Processor | Job type | `SearchIndexers`, `MonitorDownload` |
| API Route | `API.{resource}` | `API.Requests`, `API.Auth` |
| Service | Service name | `ConfigService`, `JobQueue` |

## Migration Guide

**Before:**
```typescript
console.log('[ServiceName] Operation done');
console.error('[ServiceName] Error:', error);
if (process.env.LOG_LEVEL === 'debug') {
  console.log('Debug info');
}
```

**After:**
```typescript
import { RMABLogger } from '../utils/logger';
const logger = RMABLogger.create('ServiceName');

logger.info('Operation done');
logger.error('Error', { error: error.message });
logger.debug('Debug info'); // Automatically filtered by LOG_LEVEL
```

## Related

- [Job Queue & Processors](jobs.md) - Background job system
- [Scheduler](scheduler.md) - Recurring tasks
