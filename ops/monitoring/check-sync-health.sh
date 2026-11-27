#!/usr/bin/env bash
set -euo pipefail

: "${SYNC_HEALTH_URL:?Set SYNC_HEALTH_URL to /api/operations/sync-health}"
: "${SYNC_HEALTH_BEARER_TOKEN:?Set SYNC_HEALTH_BEARER_TOKEN to an administrator session token}"

max_failed="${SYNC_ALERT_MAX_FAILED:-3}"
max_failure_rate="${SYNC_ALERT_MAX_FAILURE_RATE:-0.10}"
max_success_age_hours="${SYNC_ALERT_MAX_SUCCESS_AGE_HOURS:-36}"
response="$(curl --fail --silent --show-error --max-time 15 \
  -H "Authorization: Bearer ${SYNC_HEALTH_BEARER_TOKEN}" \
  -H 'Accept: application/json' "$SYNC_HEALTH_URL")"

alerts="$(jq -r \
  --argjson maxFailed "$max_failed" \
  --argjson maxFailureRate "$max_failure_rate" \
  --argjson maxSuccessAgeHours "$max_success_age_hours" '
  if .error != null or (.data | type) != "object" then error("invalid sync health response") else .data end
  | [
      (if .failed >= $maxFailed then "failed sync jobs: \(.failed) (limit \($maxFailed))" else empty end),
      (if (.completed + .failed) >= 10 and .failureRate >= $maxFailureRate then "sync failure rate: \(.failureRate) (limit \($maxFailureRate))" else empty end),
      (if (.staleResources | length) > 0 then "stale resources (>48h): \(.staleResources | join(", "))" else empty end),
      (if .latestSuccessAt == null then "no successful sync recorded" else
        ((now - (.latestSuccessAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 3600) as $age
        | if $age >= $maxSuccessAgeHours then "latest successful sync is \($age | floor)h old" else empty end
       end)
    ] | .[]' <<<"$response")"

if [[ -n "$alerts" ]]; then
  printf 'Walmart ERP sync health alert:\n%s\n' "$alerts" >&2
  exit 1
fi

printf 'Walmart ERP sync health is within configured thresholds.\n'
