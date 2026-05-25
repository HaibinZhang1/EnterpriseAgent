#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DRY_RUN=0
LOAD_IMAGES=1

log() { printf '[install] %s\n' "$*"; }
fail() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-load-images) LOAD_IMAGES=0 ;;
    -h|--help) printf 'Usage: %s [--dry-run] [--skip-load-images]\n' "$(basename "$0")"; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

[ -f "${DEPLOY_DIR}/docker-compose.yml" ] || fail "docker-compose.yml missing in ${DEPLOY_DIR}"
if [ ! -f "${DEPLOY_DIR}/config/.env" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN: config/.env missing; install would require copying config/.env.example and setting secrets"
  else
    fail "config/.env missing; copy config/.env.example to config/.env and set secrets before install"
  fi
fi
if [ ! -f "${DEPLOY_DIR}/config/server.env" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN: config/server.env missing; install would require copying config/server.env.example"
  else
    fail "config/server.env missing; copy config/server.env.example to config/server.env before install"
  fi
fi

if [ "$LOAD_IMAGES" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    "${SCRIPT_DIR}/load-images.sh" --dry-run
  else
    "${SCRIPT_DIR}/load-images.sh"
  fi
else
  log 'image load skipped by --skip-load-images'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY-RUN: docker compose --env-file ${DEPLOY_DIR}/config/.env -f ${DEPLOY_DIR}/docker-compose.yml up -d"
else
  docker compose --env-file "${DEPLOY_DIR}/config/.env" -f "${DEPLOY_DIR}/docker-compose.yml" up -d
fi
log 'install completed'
