# qBittorrent Integration

**Status:** ✅ Implemented

Free, open-source BitTorrent client with comprehensive Web API.

## Enterprise Torrent Addition

**Challenge:** `/api/v2/torrents/add` returns only "Ok." without torrent hash.

**Solution (Professional):**

**Magnet Links:**
1. Extract `info_hash` from magnet URI (deterministic)
2. Upload via `urls` parameter
3. Return extracted hash immediately

**Torrent Files:**
1. Download .torrent file to memory
2. Parse with `parse-torrent` (bencode decoder)
3. Extract `info_hash` (SHA-1 of info dict)
4. Upload file content via `torrents` parameter (multipart/form-data)
5. Return extracted hash immediately

**Benefits:** Deterministic, no race conditions, works with Docker networking, handles expired URLs

## API Endpoints

**Base:** `http://qbittorrent:8080/api/v2`
**Auth:** Cookie-based (login required)

**POST /auth/login** - Get session cookie
**POST /torrents/add** - Add torrent (supports `urls` and `torrents` params, `savepath` override)
**GET /torrents/info?hashes={hash}** - Get status/progress
**POST /torrents/pause** - Pause torrent
**POST /torrents/resume** - Resume
**POST /torrents/delete** - Delete torrent
**GET /torrents/files** - Get file list
**POST /torrents/createCategory** - Create category with save path
**POST /torrents/editCategory** - Update category save path
**POST /torrents/setCategory** - Set category for torrent

## Config

**Required (database only, no env fallbacks):**
- `download_client_url` - qBittorrent Web UI URL
- `download_client_username` - qBittorrent username
- `download_client_password` - qBittorrent password
- `download_dir` - Download save path (passed to qBittorrent for all torrents)

**Optional (Remote Path Mapping):**
- `download_client_remote_path_mapping_enabled` - Enable path mapping (boolean as string "true"/"false")
- `download_client_remote_path` - Remote path prefix from qBittorrent
- `download_client_local_path` - Local path prefix for ReadMeABook

Validation: All required fields checked before service initialization. Path mapping fields validated when enabled.

**Singleton Invalidation:**
Service uses singleton pattern for performance. When settings change (via admin settings page), singleton is invalidated to force reload:
- `invalidateQBittorrentService()` called after updating paths or download client settings
- Forces service to re-read database config on next torrent addition
- Ensures category save path and credentials are always current

## Category Management

**Category:** `readmeabook` (auto-created for all torrents)

**Save Path Synchronization:**
- Category created/updated on every torrent addition
- Category save path always synced with `download_dir` config
- Handles config changes: if user changes `download_dir`, category updates automatically
- Uses both `createCategory` and `editCategory` APIs for reliability

**Why Both Create and Edit:**
1. Create: Ensures category exists (idempotent, won't fail if exists)
2. Edit: Updates save path to match current config (handles user changing settings)

This prevents issues where category retains old save path after user changes `download_dir` setting.

## Remote Path Mapping

**Use Case:** qBittorrent runs on different machine/container with different filesystem perspective.

**Example Scenario:**
- qBittorrent reports: `/remote/mnt/d/done/Audiobook.Name`
- ReadMeABook needs: `/downloads/Audiobook.Name`
- Mapping: Remote `/remote/mnt/d/done` → Local `/downloads`

**Configuration:**
1. Admin Settings → Download Client → Enable Remote Path Mapping
2. Enter remote path (as reported by qBittorrent)
3. Enter local path (accessible to ReadMeABook)
4. Test connection validates local path exists
5. Save settings

**Implementation:**
- `PathMapper` utility (`src/lib/utils/path-mapper.ts`) handles transformation
- Applied in `monitor-download.processor.ts` when download completes
- Applied in `retry-failed-imports.processor.ts` for failed imports
- Uses simple prefix replacement with path normalization
- Graceful fallback: if path doesn't match remote prefix, returns unchanged

**Path Transformation:**
```typescript
// Input from qBittorrent
qbPath = "/remote/mnt/d/done/Audiobook.Name"

// Config
remotePath = "/remote/mnt/d/done"
localPath = "/downloads"

// Output (used for file organization)
organizePath = "/downloads/Audiobook.Name"
```

**Validation:**
- Local path accessibility checked during test connection
- Prevents misconfiguration before save
- Warning shown for existing downloads (mapping only affects new downloads)

**Behavior:**
- Mapping only applies when enabled
- If path doesn't start with remote prefix, returns original (logs warning)
- Path normalization handles trailing slashes, backslashes, redundant separators
- Works with both `content_path` and constructed `save_path + name`

## Data Models

```typescript
interface TorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number; // 0.0-1.0
  dlspeed: number; // bytes/s
  upspeed: number;
  eta: number; // seconds
  state: TorrentState;
  category: string;
  savePath: string;
  completionDate: number;
}

type TorrentState = 'downloading' | 'uploading' | 'stalledDL' |
  'pausedDL' | 'queuedDL' | 'checkingDL' | 'error' | 'missingFiles';
```

## Fixed Issues ✅

**1. Naive torrent identification** - Fixed with deterministic hash extraction
**2. Docker networking issues** - Fixed by downloading .torrent ourselves
**3. Duplicate detection** - Check if hash exists before adding
**4. Config fallbacks to env** - Removed, database only
**5. Unclear error messages** - List missing fields explicitly
**6. Race condition on torrent availability** - Fixed with 3s initial delay + exponential backoff retry (500ms, 1s, 2s)
**7. Error logging during duplicate check** - Removed console.error in getTorrent() during expected "not found" cases (duplicate checking)
**8. Prowlarr magnet link redirects** - Some indexers return HTTP URLs that redirect to magnet: links. Fixed by intercepting 3xx redirects before axios follows them, extracting the Location header, and routing to magnet flow if target is a magnet: link
**9. Category save path not updating** - When user changes `download_dir` setting, category keeps old path. Fixed by:
   - Checking existing categories before create/edit (avoid unnecessary 409 errors)
   - Invalidating service singleton when settings change (forces config reload)
   - Settings API calls `invalidateQBittorrentService()` after updating paths or credentials
**10. Remote seedbox path mismatch** - qBittorrent on remote machine reports different filesystem paths. Fixed by:
   - Remote path mapping feature with toggle in admin settings and setup wizard
   - PathMapper utility for prefix replacement transformation
   - Local path validation during test connection
   - Applied in download completion and import retry processors

## Tech Stack

- axios (HTTP + cookie mgmt)
- parse-torrent (bencode + hash extraction)
- form-data (multipart uploads)

## Related

- See [File Organization](./file-organization.md) for seeding support
