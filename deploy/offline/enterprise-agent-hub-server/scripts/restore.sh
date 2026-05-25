#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="${ENTERPRISE_AGENT_HUB_REPO_ROOT:-$(cd "${DEPLOY_DIR}/../../.." && pwd)}"
export RESTORE_ROOT="${RESTORE_ROOT:-${DEPLOY_DIR}}"
export CONFIG_DIR="${CONFIG_DIR:-config}"
export HEALTHCHECK_CMD="${HEALTHCHECK_CMD:-${SCRIPT_DIR}/healthcheck.sh}"
exec "${REPO_ROOT}/scripts/restore.sh" "$@"
