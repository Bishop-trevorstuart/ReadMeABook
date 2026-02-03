#!/bin/bash
# Redis startup wrapper for unified container
# Uses gosu to ensure correct PUID:PGID for file operations

set -e

# Load environment from /etc/environment (set by entrypoint)
if [ -f /etc/environment ]; then
    set -a
    source /etc/environment
    set +a
fi

# Get PUID/PGID (default to redis user's current IDs if not set)
PUID=${PUID:-$(id -u redis)}
PGID=${PGID:-$(id -g redis)}

echo "[Redis] Starting Redis server..."
echo "[Redis] Process will run as UID:GID = $PUID:$PGID"

# Use gosu to switch to correct UID:GID and start redis
# This bypasses username resolution issues when PUID collides with existing users
if [ "$(id -u)" = "0" ]; then
    # Running as root - use gosu to switch to PUID:PGID
    echo "[Redis] Switching to UID:GID $PUID:$PGID via gosu..."
    exec gosu "$PUID:$PGID" /usr/bin/redis-server --appendonly yes --dir /var/lib/redis --bind 127.0.0.1 --port 6379
else
    # Not running as root - just run directly (fallback)
    echo "[Redis] Warning: Not running as root, cannot use gosu. Running as current user."
    exec /usr/bin/redis-server --appendonly yes --dir /var/lib/redis --bind 127.0.0.1 --port 6379
fi
