#!/usr/bin/env bash
set -euo pipefail

env_file="${SYNC_HEALTH_ENV_FILE:-/etc/walmart-erp/sync-health.env}"
[[ -f "$env_file" ]] || { echo "Missing sync health environment file: $env_file" >&2; exit 2; }
permissions="$(stat -c '%a' "$env_file" 2>/dev/null || stat -f '%Lp' "$env_file")"
[[ "$permissions" == "600" ]] || { echo "Sync health environment file must have mode 600" >&2; exit 2; }

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
exec "$(dirname "$0")/check-sync-health.sh"
