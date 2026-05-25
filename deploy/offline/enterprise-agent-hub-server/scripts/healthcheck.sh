#!/usr/bin/env bash
set -euo pipefail
PORT="${SERVER_PORT:-8080}"
URL="${HEALTHCHECK_URL:-http://127.0.0.1:${PORT}/actuator/health}"
if command -v curl >/dev/null 2>&1; then
  curl -fsS "$URL" >/dev/null
elif command -v wget >/dev/null 2>&1; then
  wget -q -O - "$URL" >/dev/null
else
  printf '[healthcheck] ERROR: curl or wget is required\n' >&2
  exit 1
fi
printf '[healthcheck] OK %s\n' "$URL"
