# E-book Support

**Status:** ✅ Implemented | First-class ebook requests with multi-source support (Anna's Archive + future Indexer Search)

## Overview
Ebooks are first-class citizens in RMAB, with their own request type, tracking, and UI representation. When an audiobook request completes, an ebook request is automatically created (if a source is enabled). Supports multiple sources: Anna's Archive (direct HTTP) and Indexer Search (via Prowlarr, coming soon).

## Key Details

### First-Class Ebook Requests
- **Request Type:** `type: 'ebook'` (vs `'audiobook'`)
- **Parent Relationship:** Ebook requests are children of audiobook requests (`parentRequestId`)
- **Terminal State:** `downloaded` (ebooks don't have "available" state like audiobooks)
- **UI Badge:** Orange (#f16f19) ebook badge to distinguish from audiobooks
- **Separate Tracking:** Own progress, status, and error handling

### Flow (Anna's Archive)
1. Audiobook organization completes
2. Ebook request created automatically (if Anna's Archive enabled)
3. `search_ebook` job searches Anna's Archive
4. `start_direct_download` downloads via HTTP
5. `organize_files` copies to audiobook folder
6. Request marked as `downloaded` (terminal)
7. "Available" notification sent

### Configuration

**Admin Settings → E-book Sidecar tab** (3 sections)

#### Section 1: Anna's Archive
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_annas_archive_enabled` | `false` | Enable Anna's Archive downloads |
| `ebook_sidecar_base_url` | `https://annas-archive.li` | Base URL for mirror |
| `ebook_sidecar_flaresolverr_url` | `` (empty) | FlareSolverr proxy URL (optional) |

#### Section 2: Indexer Search
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_indexer_search_enabled` | `false` | Enable Indexer Search (not yet implemented) |

*Note: Ebook categories are configured per-indexer in Settings → Indexers → Edit Indexer → EBook tab*

#### Section 3: General Settings
| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `ebook_sidecar_preferred_format` | `epub` | `epub, pdf, mobi, azw3, any` | Preferred format |

### Source Priority
- If **Anna's Archive** is enabled → Use Anna's Archive (current behavior)
- If **only Indexer Search** is enabled → Log "not yet implemented", skip gracefully
- If **both disabled** → Ebook downloads disabled entirely

## Database Schema

**Request model additions:**
```prisma
type             String    @default("audiobook") // 'audiobook' | 'ebook'
parentRequestId  String?   @map("parent_request_id")
parentRequest    Request?  @relation("EbookParent", fields: [parentRequestId], references: [id])
childRequests    Request[] @relation("EbookParent")
```

**Indexes:** `type`, `parentRequestId`

## Job Processors

### search_ebook
- Searches Anna's Archive by ASIN first, then title + author
- Creates download history record with `downloadClient: 'direct'`
- Triggers `start_direct_download` job

### start_direct_download
- Downloads file via HTTP with progress tracking
- Tries multiple slow download links on failure
- Triggers `organize_files` on success

### monitor_direct_download
- Future use for async download monitoring
- Currently, most tracking happens in start_direct_download

## Ranking Algorithm

Ebook ranking (for future multi-source support):
- **Format Score:** 40 pts (exact match) to 10 pts (different format)
- **Size Score:** 30 pts (inverse - smaller files preferred)
- **Source Score:** 30 pts (Anna's Archive gets full score)

## Delete Behavior

**Ebook deletion is different from audiobook deletion:**
- Only deletes ebook files (`.epub`, `.pdf`, `.mobi`, etc.)
- Does NOT delete the title folder (audiobook files remain)
- Does NOT delete from backend library (Plex/ABS)
- Does NOT clear audiobook availability linkage
- Soft-deletes the ebook request record

## UI Representation

### RequestCard
- Orange ebook badge displayed next to status badge
- Orange book icon for placeholder cover art
- Interactive search disabled (Anna's Archive only)

### Status Flow
```
pending → searching → downloading → processing → downloaded (terminal)
                 ↘ awaiting_search (retry) ↗
```

## FlareSolverr Integration

Anna's Archive uses Cloudflare protection. FlareSolverr bypasses this using a headless browser.

### Setup
```bash
docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
```

Configure URL in Admin Settings → E-book Sidecar: `http://localhost:8191`

### Performance
- First request: ~5-10 seconds
- Subsequent: ~2-5 seconds per page
- Total: ~15-30 seconds per ebook

## Scraping Strategy

### Method 1: ASIN Search (exact match)
```
Search: https://annas-archive.li/search?ext=epub&lang=en&q="asin:B09TWSRMCB"
  ↓
MD5 Page: https://annas-archive.li/md5/[md5]
  ↓
Slow Download: https://annas-archive.li/slow_download/[md5]/0/5
  ↓
File Server: http://[server]/path/to/file.epub
```

### Method 2: Title + Author (fallback)
```
Search: https://annas-archive.li/search?q=Title+Author&ext=epub&lang=en
  ↓ (Same flow from MD5 page)
```

## File Naming

**Pattern:** `[Title] - [Author].[format]`

**Sanitization:**
- Remove: `<>:"/\|?*`
- Collapse spaces, trim, limit to 200 chars

## Error Handling

**Non-blocking errors:**
- No search results → Request goes to `awaiting_search` for retry
- All downloads fail → Same retry behavior
- Audiobook organization never affected

## Technical Files

**Processors:**
- `src/lib/processors/search-ebook.processor.ts`
- `src/lib/processors/direct-download.processor.ts`
- `src/lib/processors/organize-files.processor.ts` (ebook branch)

**Services:**
- `src/lib/services/ebook-scraper.ts`
- `src/lib/services/job-queue.service.ts` (ebook job types)

**Utils:**
- `src/lib/utils/file-organizer.ts` (`organizeEbook` method)
- `src/lib/utils/ranking-algorithm.ts` (`rankEbooks` function)

**UI:**
- `src/components/requests/RequestCard.tsx` (ebook badge)

**Delete:**
- `src/lib/services/request-delete.service.ts` (ebook-specific logic)

## Format Support

| Format | Extension | Recommended |
|--------|-----------|-------------|
| EPUB | `.epub` | ✅ Yes |
| PDF | `.pdf` | ⚠️ Sometimes |
| MOBI | `.mobi` | ⚠️ Legacy |
| AZW3 | `.azw3` | ⚠️ Sometimes |

## Limitations

1. Indexer Search not yet implemented (settings ready, search stubbed)
2. Title search may return wrong book for common titles
3. Download speed depends on file server load
4. English books only (title search filter)

## Indexer Categories

Indexer configuration supports separate category arrays for audiobooks and ebooks:
- **Audiobook Categories:** Default `[3030]` (Audio/Audiobook)
- **Ebook Categories:** Default `[7020]` (Books/EBook)

Categories are configured per-indexer via the tabbed interface in the Edit Indexer modal.

## Related
- [File Organization](../phase3/file-organization.md) - Ebook organization
- [Settings Pages](../settings-pages.md) - Configuration UI
- [Ranking Algorithm](../phase3/ranking-algorithm.md) - Ebook ranking
- [Request Deletion](../admin-features/request-deletion.md) - Delete behavior
