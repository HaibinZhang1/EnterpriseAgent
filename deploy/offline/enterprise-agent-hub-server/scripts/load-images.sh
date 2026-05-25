#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGES_DIR="${IMAGES_DIR:-${DEPLOY_DIR}/images}"
DRY_RUN=0

log() { printf '[load-images] %s\n' "$*"; }
fail() { printf '[load-images] ERROR: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) printf 'Usage: %s [--dry-run]\n' "$(basename "$0")"; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

[ -d "$IMAGES_DIR" ] || fail "images directory not found: ${IMAGES_DIR}"
image_count=0
while IFS= read -r image_tar; do
  image_count=$((image_count + 1))
  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN: docker load -i ${image_tar}"
  else
    docker load -i "$image_tar"
  fi
done < <(find "$IMAGES_DIR" -maxdepth 1 -type f -name '*.tar' -print | sort)

if [ "$image_count" -eq 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN: no image tar files found in ${IMAGES_DIR}; real offline image bundle is deferred"
    exit 0
  fi
  fail "no image tar files found in ${IMAGES_DIR}; real offline image bundle is deferred and must be supplied before loading"
fi
log 'image load completed'
