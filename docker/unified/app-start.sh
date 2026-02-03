#!/bin/bash
# App startup wrapper for unified container
# Uses gosu to ensure correct PUID:PGID for file operations

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

# Use gosu to switch to correct UID:GID and start server
# This bypasses username resolution issues when PUID collides with existing users
if [ "$(id -u)" = "0" ]; then
    # Running as root - use gosu to switch to PUID:PGID
    echo "[App] Switching to UID:GID $PUID:$PGID via gosu..."

    # Start server in background with gosu
    gosu "$PUID:$PGID" node server.js &
    SERVER_PID=$!

    echo "[App] Waiting for server to be ready..."
    sleep 5

    # Initialize application services (creates default scheduled jobs)
    echo "[App] Initializing application services..."
    curl -sf http://localhost:3030/api/init || echo "[App] Warning: Failed to initialize services (may already be initialized)"

    echo "[App] Server ready with PID $SERVER_PID (running as $PUID:$PGID)"

    # Verify the process is running with correct UID:GID
    if [ -f "/proc/$SERVER_PID/status" ]; then
        ACTUAL_UID=$(grep '^Uid:' /proc/$SERVER_PID/status | awk '{print $2}')
        ACTUAL_GID=$(grep '^Gid:' /proc/$SERVER_PID/status | awk '{print $2}')
        echo "[App] Verified process credentials: UID=$ACTUAL_UID GID=$ACTUAL_GID"

        if [ "$ACTUAL_UID" != "$PUID" ] || [ "$ACTUAL_GID" != "$PGID" ]; then
            echo "[App] WARNING: Process UID:GID ($ACTUAL_UID:$ACTUAL_GID) does not match expected ($PUID:$PGID)"
        fi
    fi

    # Wait for server process
    wait $SERVER_PID
else
    # Not running as root - just run directly (fallback)
    echo "[App] Warning: Not running as root, cannot use gosu. Running as current user."
    exec node server.js
fi
