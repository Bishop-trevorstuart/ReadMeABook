#!/bin/bash
# Redis startup wrapper for unified container
# Smart supervisor: detects external Redis and sleeps instead of starting local instance
#
# Behavior:
# - If REDIS_URL points to external host (not 127.0.0.1/localhost), sleep infinity
# - Otherwise, start local Redis instance
#
# Uses gosu to ensure correct PUID:PGID for file operations
#
# Supports:
# - Docker/LXC: Uses gosu to switch to PUID:PGID (default)
# - Rootless Podman: Set ROOTLESS_CONTAINER=true to skip gosu

set -e

# Load environment from /etc/environment (set by entrypoint)
if [ -f /etc/environment ]; then
    set -a
    source /etc/environment
    set +a
fi

echo "[Redis] Checking for external Redis configuration..."

# Extract host from REDIS_URL
# Format: redis://host:port or redis://:password@host:port
if [ -n "$REDIS_URL" ]; then
    # Extract the host part (between :// or @, and :port or end)
    REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:@]*@\)\?\([^:/]*\).*|\2|p')
    
    echo "[Redis] Detected REDIS_URL host: $REDIS_HOST"
    
    # Check if host is external (not localhost or 127.0.0.1)
    if [ "$REDIS_HOST" != "127.0.0.1" ] && [ "$REDIS_HOST" != "localhost" ]; then
        echo "[Redis] ✅ External Redis detected at $REDIS_HOST"
        echo "[Redis] Skipping local Redis startup - sleeping to keep supervisord happy"
        exec sleep infinity
    fi
fi

echo "[Redis] Starting local Redis server..."

# Get PUID/PGID (default to redis user's current IDs if not set)
PUID=${PUID:-$(id -u redis)}
PGID=${PGID:-$(id -g redis)}

echo "[Redis] Process will run as UID:GID = $PUID:$PGID"

# =============================================================================
# START REDIS WITH APPROPRIATE UID:GID HANDLING
# =============================================================================
# Two scenarios:
# 1. Default: Running as root, use gosu to switch to PUID:PGID
# 2. ROOTLESS_CONTAINER=true: Skip gosu (rootless Podman user namespace handles UID mapping)

REDIS_CMD="/usr/bin/redis-server --appendonly yes --dir /var/lib/redis --bind 127.0.0.1 --port 6379"

if [ "$(id -u)" = "0" ]; then
    if [ "${ROOTLESS_CONTAINER}" = "true" ]; then
        # Rootless Podman: Skip gosu - user namespace already maps UID 0 to host user
        echo "[Redis] ROOTLESS_CONTAINER=true - skipping gosu (user namespace handles UID mapping)"
        exec $REDIS_CMD
    else
        # Default: Use gosu to switch to the specified PUID:PGID
        echo "[Redis] Switching to UID:GID $PUID:$PGID via gosu..."
        exec gosu "$PUID:$PGID" $REDIS_CMD
    fi
else
    # Not running as root - run directly (fallback for unusual configurations)
    echo "[Redis] Warning: Not running as root, cannot use gosu. Running as current user ($(id -u):$(id -g))."
    exec $REDIS_CMD
fi
