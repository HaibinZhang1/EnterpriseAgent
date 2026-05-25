#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
BACKUP_DIR=""
DRY_RUN=0
FORCE=0
RESTORE_ROOT="${RESTORE_ROOT:-.}"
POSTGRES_RESTORE_CMD="${POSTGRES_RESTORE_CMD:-pg_restore}"
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
HEALTHCHECK_CMD="${HEALTHCHECK_CMD:-scripts/healthcheck.sh}"
FLYWAY_CHECK_CMD="${FLYWAY_CHECK_CMD:-}"
SKIP_DB_RESTORE="${SKIP_DB_RESTORE:-0}"
SKIP_FILE_RESTORE="${SKIP_FILE_RESTORE:-0}"

usage() {
  cat <<USAGE
Usage: ${SCRIPT_NAME} --backup-dir DIR [--dry-run] [--force]

Validates backup checksums, requires explicit confirmation (or --force), restores
PostgreSQL plus storage/config files, then runs health/Flyway/package existence
checks where configured or available.

Environment overrides: RESTORE_ROOT, DATABASE_URL or POSTGRES_* vars,
STORAGE_DIR, CONFIG_DIR, UPDATE_PACKAGES_DIR, PACKAGE_MANIFESTS_DIR,
PLUGIN_PACKAGES_DIR, INSTALL_MANIFESTS_DIR, HEALTHCHECK_CMD, FLYWAY_CHECK_CMD,
SKIP_DB_RESTORE=1, SKIP_FILE_RESTORE=1.
USAGE
}

log() { printf '[restore] %s\n' "$*"; }
fail() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup-dir) shift; [ "$#" -gt 0 ] || fail '--backup-dir requires a value'; BACKUP_DIR="$1" ;;
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

[ -n "$BACKUP_DIR" ] || fail '--backup-dir is required'
[ -d "$BACKUP_DIR" ] || fail "backup directory does not exist: ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/manifest/SHA256SUMS" ] || fail "checksum summary missing: ${BACKUP_DIR}/manifest/SHA256SUMS"

sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$BACKUP_DIR" && sha256sum -c manifest/SHA256SUMS)
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$BACKUP_DIR" && shasum -a 256 -c manifest/SHA256SUMS)
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

confirm_restore() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log 'dry-run enabled; confirmation bypassed because no changes will be made'
    return
  fi
  if [ "$FORCE" -eq 1 ]; then
    log '--force supplied; confirmation bypassed'
    return
  fi
  printf 'Restore backup %s into %s? Type RESTORE to continue: ' "$BACKUP_DIR" "$RESTORE_ROOT" >&2
  read -r answer
  [ "$answer" = 'RESTORE' ] || fail 'restore confirmation not provided'
}

copy_if_present() {
  local src="$1"
  local dest="$2"
  local label="$3"
  if [ -e "$src" ]; then
    log "restoring ${label}: ${src} -> ${dest}"
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$(dirname "$dest")"
      rm -rf -- "$dest"
      cp -a "$src" "$dest"
    fi
  else
    log "${label} not present in backup; skipping"
  fi
}

log 'validating SHA-256 checksum summary'
sha256_check >/tmp/enterprise-agent-hub-restore-checksums.$$ 2>&1 || {
  cat /tmp/enterprise-agent-hub-restore-checksums.$$ >&2
  rm -f /tmp/enterprise-agent-hub-restore-checksums.$$
  fail 'checksum validation failed'
}
cat /tmp/enterprise-agent-hub-restore-checksums.$$
rm -f /tmp/enterprise-agent-hub-restore-checksums.$$

confirm_restore

DUMP_FILE="${BACKUP_DIR}/postgres/enterprise_agent_hub.dump"
if [ "$SKIP_DB_RESTORE" = '1' ]; then
  log 'SKIP_DB_RESTORE=1; database restore skipped'
elif [ -f "$DUMP_FILE" ]; then
  log "restoring PostgreSQL dump: ${DUMP_FILE}"
  if [ "$DRY_RUN" -eq 0 ]; then
    command -v "$POSTGRES_RESTORE_CMD" >/dev/null 2>&1 || fail "${POSTGRES_RESTORE_CMD} is required for PostgreSQL restore"
    if [ -n "$POSTGRES_URI" ]; then
      "$POSTGRES_RESTORE_CMD" --clean --if-exists --no-owner --no-privileges --dbname "$POSTGRES_URI" "$DUMP_FILE"
    else
      PGPASSWORD="${POSTGRES_PASSWORD:-}" "$POSTGRES_RESTORE_CMD" --clean --if-exists --no-owner --no-privileges \
        --host "$POSTGRES_HOST" --port "$POSTGRES_PORT" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$DUMP_FILE"
    fi
  fi
else
  fail "PostgreSQL dump missing: ${DUMP_FILE}"
fi

if [ "$SKIP_FILE_RESTORE" = '1' ]; then
  log 'SKIP_FILE_RESTORE=1; file restore skipped'
else
  copy_if_present "${BACKUP_DIR}/files/storage" "${RESTORE_ROOT%/}/${STORAGE_DIR}" 'storage root'
  copy_if_present "${BACKUP_DIR}/files/config" "${RESTORE_ROOT%/}/${CONFIG_DIR}" 'config directory'
  copy_if_present "${BACKUP_DIR}/files/client-updates" "${RESTORE_ROOT%/}/${UPDATE_PACKAGES_DIR}" 'client update packages'
  copy_if_present "${BACKUP_DIR}/files/package-manifests" "${RESTORE_ROOT%/}/${PACKAGE_MANIFESTS_DIR}" 'package manifests'
  copy_if_present "${BACKUP_DIR}/files/plugin-packages" "${RESTORE_ROOT%/}/${PLUGIN_PACKAGES_DIR}" 'plugin packages'
  copy_if_present "${BACKUP_DIR}/files/install-manifests" "${RESTORE_ROOT%/}/${INSTALL_MANIFESTS_DIR}" 'install manifests'
fi

CLIENT_UPDATE_BACKUP_DIR=""
if [ -d "${BACKUP_DIR}/files/client-updates" ]; then
  CLIENT_UPDATE_BACKUP_DIR="${BACKUP_DIR}/files/client-updates"
elif [ -d "${BACKUP_DIR}/files/storage/client-updates" ]; then
  CLIENT_UPDATE_BACKUP_DIR="${BACKUP_DIR}/files/storage/client-updates"
fi
if [ -n "$CLIENT_UPDATE_BACKUP_DIR" ]; then
  if find "$CLIENT_UPDATE_BACKUP_DIR" -maxdepth 10 -type f -print -quit | grep -q .; then
    log 'client update package files found in backup'
  else
    log 'client update package directory exists but contains no files'
  fi
else
  log 'client update package directory not present in backup; verify whether this environment has published updates'
fi
if [ -d "${BACKUP_DIR}/files/package-manifests" ] || [ -d "${BACKUP_DIR}/files/install-manifests" ]; then
  log 'package/install manifest files found in backup'
else
  log 'package/install manifest directories not present in backup; verify whether this environment has package manifests'
fi

if [ -n "$FLYWAY_CHECK_CMD" ]; then
  log "running configured Flyway check: ${FLYWAY_CHECK_CMD}"
  if [ "$DRY_RUN" -eq 0 ]; then
    sh -c "$FLYWAY_CHECK_CMD"
  fi
else
  log 'Flyway check not configured; set FLYWAY_CHECK_CMD to run migration validation after restore'
fi

if [ -x "$HEALTHCHECK_CMD" ] || command -v "$HEALTHCHECK_CMD" >/dev/null 2>&1; then
  log "running health check: ${HEALTHCHECK_CMD}"
  if [ "$DRY_RUN" -eq 0 ]; then
    "$HEALTHCHECK_CMD"
  fi
else
  log "health check command not available, skipping: ${HEALTHCHECK_CMD}"
fi

log 'restore completed successfully'
