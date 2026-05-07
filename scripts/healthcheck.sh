#!/bin/sh
set -eu
PORT="${SERVER_PORT:-8080}"
URL="http://127.0.0.1:${PORT}/actuator/health"
if command -v curl >/dev/null 2>&1; then
  curl -fsS "$URL" >/dev/null
else
  wget -q -O - "$URL" >/dev/null
fi
