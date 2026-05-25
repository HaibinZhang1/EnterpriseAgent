#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="${ENTERPRISE_AGENT_HUB_REPO_ROOT:-$(cd "${DEPLOY_DIR}/../../.." && pwd)}"
export BACKUP_ROOT="${BACKUP_ROOT:-${DEPLOY_DIR}/backups}"
export CONFIG_DIR="${CONFIG_DIR:-${DEPLOY_DIR}/config}"
exec "${REPO_ROOT}/scripts/backup.sh" "$@"
