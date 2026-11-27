#!/usr/bin/env bash
set -Eeuo pipefail
usage() { echo "Usage: $0 --input FILE.age --identity FILE --host HOST --database DB [--port PORT] [--user USER] [--yes]" >&2; exit 2; }
input=""; identity=""; host=""; database=""; port="${MYSQL_PORT:-3306}"; user="${MYSQL_USER:-walmart}"; yes="false"
while (($#)); do
  case "$1" in
    --input) [[ $# -ge 2 ]] || usage; input="$2"; shift 2;;
    --identity) [[ $# -ge 2 ]] || usage; identity="$2"; shift 2;;
    --host) [[ $# -ge 2 ]] || usage; host="$2"; shift 2;;
    --database) [[ $# -ge 2 ]] || usage; database="$2"; shift 2;;
    --port) [[ $# -ge 2 ]] || usage; port="$2"; shift 2;;
    --user) [[ $# -ge 2 ]] || usage; user="$2"; shift 2;;
    --yes) yes="true"; shift;;
    *) usage;;
  esac
done
[[ -f "$input" && -f "$identity" && -n "$host" && -n "$database" ]] || usage
command -v age >/dev/null || { echo "age is required to decrypt backups" >&2; exit 1; }
if [[ "$database" =~ (prod|production) || "$host" =~ (prod|production) ]]; then echo "Refusing restore to a production-looking target; use an explicit reviewed procedure." >&2; exit 1; fi
[[ "$yes" == "true" ]] || { echo "Restore is destructive; repeat with --yes after reviewing the target." >&2; exit 1; }
: "${MYSQL_PASSWORD:?Set MYSQL_PASSWORD without printing it}"; export MYSQL_PWD="$MYSQL_PASSWORD"
age --decrypt --identity "$identity" "$input" | gzip -dc | mysql --host="$host" --port="$port" --user="$user" "$database"
unset MYSQL_PWD; echo "Restore completed for the explicitly supplied target"
