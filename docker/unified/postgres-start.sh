#!/bin/bash
# PostgreSQL startup wrapper for unified container
# Smart supervisor: detects external PostgreSQL and sleeps instead of starting local instance
#
# Behavior:
# - If DATABASE_URL points to external host (not 127.0.0.1/localhost), sleep infinity
# - Otherwise, start local PostgreSQL instance

set -e

# Load environment from /etc/environment (set by entrypoint)
if [ -f /etc/environment ]; then
    set -a
    source /etc/environment
    set +a
fi

echo "[PostgreSQL] Checking for external database configuration..."

# Extract host from DATABASE_URL
# Format: postgresql://user:pass@host:port/db
if [ -n "$DATABASE_URL" ]; then
    # Extract the host part (between @ and :port or /)
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    
    echo "[PostgreSQL] Detected DATABASE_URL host: $DB_HOST"
    
    # Check if host is external (not localhost or 127.0.0.1)
    if [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "localhost" ]; then
        echo "[PostgreSQL] ✅ External PostgreSQL detected at $DB_HOST"
        echo "[PostgreSQL] Skipping local PostgreSQL startup - sleeping to keep supervisord happy"
        exec sleep infinity
    fi
fi

echo "[PostgreSQL] Starting local PostgreSQL server..."

# Start PostgreSQL as postgres user
exec /usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/data
