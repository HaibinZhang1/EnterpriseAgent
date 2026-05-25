#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
BACKUP_ROOT="${BACKUP_ROOT:-backups}"
RETENTION="${RETENTION:-7}"
DRY_RUN=0
TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
POSTGRES_DUMP_CMD="${POSTGRES_DUMP_CMD:-pg_dump}"
POSTGRES_URI="${POSTGRES_URI:-${DATABASE_URL:-}}"
POSTGRES_DB="${POSTGRES_DB:-enterprise_agent_hub}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
STORAGE_DIR="${STORAGE_DIR:-storage}"
CONFIG_DIR="${CONFIG_DIR:-config}"
UPDATE_PACKAGES_DIR="${UPDATE_PACKAGES_DIR:-storage/client-updates}"
PACKAGE_MANIFESTS_DIR="${PACKAGE_MANIFESTS_DIR:-storage/manifests}"
PLUGIN_PACKAGES_DIR="${PLUGIN_PACKAGES_DIR:-storage/plugin-packages}"
INSTALL_MANIFESTS_DIR="${INSTALL_MANIFESTS_DIR:-storage/install-manifests}"
INCLUDE_AUDIT_EXPORT="${INCLUDE_AUDIT_EXPORT:-}"

usage() {
  cat <<USAGE
Usage: ${SCRIPT_NAME} [--dry-run] [--output-dir DIR] [--retention N]

Creates a timestamped Enterprise Agent Hub backup containing:
  - PostgreSQL dump
  - storage files, client update packages, package/install manifests, plugin packages
  - runtime config
  - optional audit/settings/device/update CSV export file via INCLUDE_AUDIT_EXPORT
  - SHA-256 checksum summary and backup manifest

Environment overrides: BACKUP_ROOT, RETENTION, DATABASE_URL or POSTGRES_* vars,
STORAGE_DIR, CONFIG_DIR, UPDATE_PACKAGES_DIR, PACKAGE_MANIFESTS_DIR,
PLUGIN_PACKAGES_DIR, INSTALL_MANIFESTS_DIR, INCLUDE_AUDIT_EXPORT.
Default retention keeps the newest 7 backup directories.
USAGE
}

log() { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --output-dir) shift; [ "$#" -gt 0 ] || fail '--output-dir requires a value'; BACKUP_ROOT="$1" ;;
    --retention) shift; [ "$#" -gt 0 ] || fail '--retention requires a value'; RETENTION="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

case "$RETENTION" in
  ''|*[!0-9]*) fail "retention must be a non-negative integer: ${RETENTION}" ;;
esac

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    fail 'sha256sum or shasum is required'
  fi
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN: $*"
  else
    "$@"
  fi
}

copy_if_present() {
  local src="$1"
  local dest="$2"
  local label="$3"
  if [ -e "$src" ]; then
    log "including ${label}: ${src}"
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$(dirname "$dest")"
      cp -a "$src" "$dest"
    fi
  else
    log "optional ${label} not found, recording as missing: ${src}"
    if [ "$DRY_RUN" -eq 0 ]; then
      printf '%s\n' "$src" >> "${BACKUP_DIR}/manifest/missing-paths.txt"
    fi
  fi
}

BACKUP_DIR="${BACKUP_ROOT%/}/enterprise-agent-hub-${TIMESTAMP}"

log "backup directory: ${BACKUP_DIR}"
log "retention: keep newest ${RETENTION} backup(s)"

if [ "$DRY_RUN" -eq 0 ]; then
  [ ! -e "$BACKUP_DIR" ] || fail "backup directory already exists: ${BACKUP_DIR}"
  mkdir -p "${BACKUP_DIR}/postgres" "${BACKUP_DIR}/files" "${BACKUP_DIR}/manifest"
else
  log 'dry-run enabled; no files will be created and no database dump will run'
fi

if [ -n "$POSTGRES_URI" ]; then
  log 'PostgreSQL dump source: DATABASE_URL/POSTGRES_URI'
  if [ "$DRY_RUN" -eq 0 ]; then
    command -v "$POSTGRES_DUMP_CMD" >/dev/null 2>&1 || fail "${POSTGRES_DUMP_CMD} is required for PostgreSQL backup"
    "$POSTGRES_DUMP_CMD" --format=custom --no-owner --no-privileges "$POSTGRES_URI" > "${BACKUP_DIR}/postgres/enterprise_agent_hub.dump"
  fi
else
  log "PostgreSQL dump source: ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  if [ "$DRY_RUN" -eq 0 ]; then
    command -v "$POSTGRES_DUMP_CMD" >/dev/null 2>&1 || fail "${POSTGRES_DUMP_CMD} is required for PostgreSQL backup"
    PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_DUMP_CMD" --format=custom --no-owner --no-privileges \
      --host "$POSTGRES_HOST" --port "$POSTGRES_PORT" --username "$POSTGRES_USER" "$POSTGRES_DB" \
      > "${BACKUP_DIR}/postgres/enterprise_agent_hub.dump"
  fi
fi

copy_if_present "$STORAGE_DIR" "${BACKUP_DIR}/files/storage" 'storage root'
copy_if_present "$CONFIG_DIR" "${BACKUP_DIR}/files/config" 'config directory'
copy_if_present "$UPDATE_PACKAGES_DIR" "${BACKUP_DIR}/files/client-updates" 'client update packages'
copy_if_present "$PACKAGE_MANIFESTS_DIR" "${BACKUP_DIR}/files/package-manifests" 'package manifests'
copy_if_present "$PLUGIN_PACKAGES_DIR" "${BACKUP_DIR}/files/plugin-packages" 'plugin packages'
copy_if_present "$INSTALL_MANIFESTS_DIR" "${BACKUP_DIR}/files/install-manifests" 'install manifests'

if [ -n "$INCLUDE_AUDIT_EXPORT" ]; then
  copy_if_present "$INCLUDE_AUDIT_EXPORT" "${BACKUP_DIR}/files/audit-settings-device-update-export.csv" 'audit/settings/device/update export'
else
  log 'optional audit/settings/device/update export not configured; set INCLUDE_AUDIT_EXPORT to include a CSV export'
fi

if [ "$DRY_RUN" -eq 0 ]; then
  cat > "${BACKUP_DIR}/manifest/backup-info.txt" <<INFO
created_utc=${TIMESTAMP}
postgres_db=${POSTGRES_DB}
postgres_host=${POSTGRES_HOST}
storage_dir=${STORAGE_DIR}
config_dir=${CONFIG_DIR}
update_packages_dir=${UPDATE_PACKAGES_DIR}
package_manifests_dir=${PACKAGE_MANIFESTS_DIR}
plugin_packages_dir=${PLUGIN_PACKAGES_DIR}
install_manifests_dir=${INSTALL_MANIFESTS_DIR}
INFO
  (
    cd "$BACKUP_DIR"
    find . -type f ! -path './manifest/SHA256SUMS' -print | LC_ALL=C sort | while IFS= read -r file; do
      sha256_file "$file"
    done > manifest/SHA256SUMS
  )
  log "checksum summary: ${BACKUP_DIR}/manifest/SHA256SUMS"

  if [ "$RETENTION" -gt 0 ] && [ -d "$BACKUP_ROOT" ]; then
    find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'enterprise-agent-hub-*' -print | sort -r | tail -n +$((RETENTION + 1)) | while IFS= read -r old_backup; do
      [ -n "$old_backup" ] || continue
      log "pruning old backup: ${old_backup}"
      rm -rf -- "$old_backup"
    done
  fi
fi

log 'backup completed successfully'
