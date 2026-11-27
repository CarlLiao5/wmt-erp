# Operations runbook

## Start and health checks

Start MySQL and Redis with `docker compose up -d mysql redis`, then start API, Worker, and Web using the repository's `dev:api`, `dev:worker`, and `dev:web` commands (or the persistent service supervisor). Confirm `curl -fsS http://localhost:3000/api/health` and the Web URL before accepting traffic.

## Sync monitoring

As an authenticated administrator, call `GET /api/operations/sync-health`. The response reports queued, running, completed, and failed jobs, the latest successful job timestamp, and resources with raw data older than 48 hours. Investigate stale data before replaying jobs. `POST /api/sync-jobs/:id/replay` accepts only a failed job in the administrator's tenant and returns `202`; it is safe to retry the same failed job only after checking the queue state.

`latestSuccessAt` uses the actual `completed_at` timestamp. Jobs completed before migration `0018` retain `NULL` rather than copying `available_at`, because that field is the schedule/availability time and cannot establish when work finished. The field becomes populated as those jobs run again.

## Initial backfill and incremental plans

Create a tenant-scoped plan with `POST /api/sync/plans` using `{ storeId, resources, mode: "initial" }`, then inspect `GET /api/sync/plans/:id`. Sync Status displays the same coverage and retry state. Orders are intentionally bounded to Walmart's most recent 180 days; each query window must stay below the 10,000-result total limit and uses pages of at most 200. A plan reporting `orders_api_180_day_limit` is complete for the API boundary, not evidence of older order data.

Returns initial sync uses boundary probing and records the actual earliest date. Recon plans follow Walmart's available report dates and page JSON rows at 1,000 records. Direct WFS inventory logs accept date bounds for up to 365 days; older history requires the report strategy or an explicit unavailable state. Do not start a production plan until the store credentials and the intended date range have been approved.

### Scheduled incremental sync

Before starting a Worker with the incremental scheduler, apply migration `0023_incremental_sync_schedule.sql` manually and verify the new schedule columns exist. The Worker checks finished initial plans at startup and every 15 seconds; `completed` and `partial` plans create one idempotent incremental plan for supported resources. Existing finished initial plans are included. Station ads (`advertising` / `advertising-onsite`) are intentionally excluded; SEM is scheduled separately. Sync Status lists incremental plans by store/resource with cadence, next run, latest window result, and completed/failed counts. Authorized users can pause or resume a plan there; pausing prevents future windows and supersedes windows not yet queued, while queued/running jobs finish. Resuming schedules the next run after the normal interval without replaying downtime.

Default intervals and overlap ranges are defined in `packages/domain/src/syncPolicies.ts`. The scheduler persists each due window before enqueueing it, advances the next run without replaying every missed interval after downtime, and reconciles planned/queued/running windows against BullMQ on the next tick. The Worker runs one queue job at a time. Manual changes to `sync_plans.enabled`/`next_run_at` are reserved for recovery; use Sync Status for routine pause/resume. Do not enable a resource whose source endpoint is known to return 404.

Walmart requests share a per-seller/API pacing bucket. Known endpoints are paced below the published default quota; unknown endpoints are serialized. `x-current-token-count`, `X-Next-Replenishment-Time`, and `Retry-After` can extend the wait. SEM report downloads from the returned signed URL are external file transfers and do not consume the Walmart API bucket.

## Retention

Run `pnpm --filter @walmart-erp/db retention -- --raw-payload-days=180 --sync-job-days=90` for a read-only dry-run with candidate row counts and UTC cutoffs. Retention periods have no implicit defaults: set both values explicitly or provide `RETENTION_RAW_PAYLOAD_DAYS` / `RETENTION_SYNC_JOB_DAYS`. After reviewing dry-run results, execution requires `--execute`, `--operator`, and `--backup-id`:

```sh
pnpm --filter @walmart-erp/db retention -- --raw-payload-days=180 --sync-job-days=90 --execute --operator='name' --backup-id='backup-reference'
```

The execution is one MySQL transaction and writes an `audit_events` row under the `system-retention` tenant marker containing the operator, backup identifier, cutoffs and actual deleted row counts. It removes raw payloads by `received_at`, and only terminal (`completed`/`failed`) jobs by `created_at`; queued and running jobs are never eligible. Review the dry-run counts and confirm the referenced encrypted backup exists before execution. No scheduled destructive cleanup is configured.

## Sync alerts

`ops/monitoring/check-sync-health.sh` is a non-mutating check for a cron job or external monitor. Configure `SYNC_HEALTH_URL` (the authenticated `/api/operations/sync-health` URL) and `SYNC_HEALTH_BEARER_TOKEN` from the secret store. Defaults alert at 3 failed jobs, a failure rate of 10% once at least 10 jobs are terminal, any resource stale for over 48 hours, or no successful sync in 36 hours. Override thresholds with `SYNC_ALERT_MAX_FAILED`, `SYNC_ALERT_MAX_FAILURE_RATE`, and `SYNC_ALERT_MAX_SUCCESS_AGE_HOURS`. It exits nonzero and writes actionable details to stderr when a threshold is reached; the scheduler/monitor must deliver that result to the operator. Rotate the administrator session token before it expires.

For a host cron deployment, copy [`ops/monitoring/sync-health.cron.example`](ops/monitoring/sync-health.cron.example) to `/etc/cron.d/walmart-erp-sync-health`, install [`run-sync-health-check.sh`](ops/monitoring/run-sync-health-check.sh), and create `/etc/walmart-erp/sync-health.env` with mode `600`:

```sh
SYNC_HEALTH_URL=http://127.0.0.1:3000/api/operations/sync-health
SYNC_HEALTH_BEARER_TOKEN=provided-by-the-secret-store
```

The wrapper refuses a missing or non-`600` env file and `flock` prevents overlapping checks. Cron log delivery is intentionally left to the host's log/alert system; no credential is placed in the crontab.

## Backup and recovery

Follow [`ops/backup/README.md`](ops/backup/README.md). Backups use a consistent `mysqldump` transaction and restricted file permissions. Test restores into a non-production database, run migrations, verify tenant isolation and key row counts, and only then restart API/Worker.

## Release gate

Before release, run `pnpm release:gate`. It runs the full Vitest suite, package type checks, lint, read-only contract, production dependency audit, migration check, Compose validation, API health, and `git diff --check`. Review that no Walmart business method other than `GET` was introduced, no tenant/store scope was removed, and no secret appears in logs or error responses. Keep the previous image and database backup available until the post-release sync health check is green.

## Stale worker recovery

Stop duplicate Worker processes, verify Redis queue ownership, and start exactly one Worker. Do not delete queued jobs. Use the sync health endpoint to confirm running jobs settle, then replay only terminal failures.
