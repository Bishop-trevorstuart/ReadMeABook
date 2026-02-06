#!/bin/bash
# App startup wrapper for unified container
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

# Get PUID/PGID (default to node user's current IDs if not set)
PUID=${PUID:-$(id -u node)}
PGID=${PGID:-$(id -g node)}

echo "[App] Starting Next.js server..."
echo "[App] Process will run as UID:GID = $PUID:$PGID"

cd /app

# =============================================================================
# START SERVER WITH APPROPRIATE UID:GID HANDLING
# =============================================================================
# Two scenarios:
# 1. Default: Running as root, use gosu to switch to PUID:PGID
# 2. ROOTLESS_CONTAINER=true: Skip gosu (rootless Podman user namespace handles UID mapping)

start_server() {
    if [ "$(id -u)" = "0" ]; then
        if [ "${ROOTLESS_CONTAINER}" = "true" ]; then
            # Rootless Podman: Skip gosu - user namespace already maps UID 0 to host user
            echo "[App] ROOTLESS_CONTAINER=true - skipping gosu (user namespace handles UID mapping)"
            node server.js &
        else
            # Default: Use gosu to switch to the specified PUID:PGID
            echo "[App] Switching to UID:GID $PUID:$PGID via gosu..."
            gosu "$PUID:$PGID" node server.js &
        fi
    else
        # Not running as root - run directly (fallback for unusual configurations)
        echo "[App] Warning: Not running as root, cannot use gosu. Running as current user ($(id -u):$(id -g))."
        node server.js &
    fi
}

# Start the server in background
start_server
SERVER_PID=$!

echo "[App] Waiting for server to be ready..."
sleep 5

# Initialize application services (creates default scheduled jobs)
echo "[App] Initializing application services..."
curl -sf http://localhost:3030/api/init || echo "[App] Warning: Failed to initialize services (may already be initialized)"

echo "[App] Server ready with PID $SERVER_PID"

# Verify the process is running with correct UID:GID (for debugging)
if [ -f "/proc/$SERVER_PID/status" ]; then
    ACTUAL_UID=$(grep '^Uid:' /proc/$SERVER_PID/status | awk '{print $2}')
    ACTUAL_GID=$(grep '^Gid:' /proc/$SERVER_PID/status | awk '{print $2}')
    echo "[App] Verified process credentials: UID=$ACTUAL_UID GID=$ACTUAL_GID"

    if [ "${ROOTLESS_CONTAINER}" != "true" ] && { [ "$ACTUAL_UID" != "$PUID" ] || [ "$ACTUAL_GID" != "$PGID" ]; }; then
        echo "[App] WARNING: Process UID:GID ($ACTUAL_UID:$ACTUAL_GID) does not match expected ($PUID:$PGID)"
    fi
fi

# Wait for server process (keeps the script running as long as the server is alive)
wait $SERVER_PID
