#!/usr/bin/env bash
set -Eeuo pipefail
usage() { echo "Usage: $0 --output-dir DIR --age-recipient RECIPIENT [--host HOST] [--port PORT] [--user USER] [--database DB]" >&2; exit 2; }
output_dir=""; host="${MYSQL_HOST:-127.0.0.1}"; port="${MYSQL_PORT:-3306}"; user="${MYSQL_USER:-walmart}"; database="${MYSQL_DATABASE:-walmart_erp}"
age_recipient="${BACKUP_AGE_RECIPIENT:-}"
while (($#)); do
  case "$1" in
    --output-dir) [[ $# -ge 2 ]] || usage; output_dir="$2"; shift 2;;
    --host) [[ $# -ge 2 ]] || usage; host="$2"; shift 2;;
    --port) [[ $# -ge 2 ]] || usage; port="$2"; shift 2;;
    --user) [[ $# -ge 2 ]] || usage; user="$2"; shift 2;;
    --database) [[ $# -ge 2 ]] || usage; database="$2"; shift 2;;
    --age-recipient) [[ $# -ge 2 ]] || usage; age_recipient="$2"; shift 2;;
    *) usage;;
  esac
done
[[ -n "$output_dir" && -n "$age_recipient" ]] || usage
command -v age >/dev/null || { echo "age is required for encrypted backups" >&2; exit 1; }
mkdir -p "$output_dir"; timestamp="$(date -u +%Y%m%dT%H%M%SZ)"; target="$output_dir/${database}_${timestamp}.sql.gz.age"; tmp="$(mktemp "$output_dir/.${database}_${timestamp}.XXXXXX")"; umask 077
trap 'rm -f "$tmp"' EXIT
: "${MYSQL_PASSWORD:?Set MYSQL_PASSWORD without printing it}"; export MYSQL_PWD="$MYSQL_PASSWORD"
mysqldump --host="$host" --port="$port" --user="$user" --single-transaction --routines --events --triggers --hex-blob "$database" | gzip -c | age --encrypt --recipient "$age_recipient" > "$tmp"
unset MYSQL_PWD; mv "$tmp" "$target"; trap - EXIT; echo "Backup written to $target"
