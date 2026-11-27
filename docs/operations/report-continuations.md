# Resumable Walmart reports

The Worker runs ITEM, SEM_PERFORMANCE, SEM_SEARCH_TERMS, and INVENTORY_RECON
inside a report continuation. This applies equally to initial, incremental,
and manually queued sync jobs.

- `SyncRequest.reportContinuation` is checkpointed with BullMQ `job.updateData`
  before returning successful submission receipts. The checkpoint key hashes
  environment, client ID, method, path and body, keeping report periods separate.
- Successful submission receipts and terminal READY status responses are reused
  on the next execution. Pending responses are polled again. Signed download
  URLs, access tokens and report content are not cached in the continuation.
- Report-generation waits, request spacing and HTTP 429 waits raise
  `ReportDeferred`. The queue records `queued`, the next `available_at` and a
  phase summary, then calls `moveToDelayed` and throws BullMQ `DelayedError`.
  These waits do not increment failure attempts or fail reconciliation runs.
- API spacing/cooldown is saved in Redis under a hashed credential bucket.
  A monotonic-max Lua update preserves longer server cooldowns across Worker
  restarts. The existing six-minute report spacing remains in force.
- A 24-hour total deadline starts on first execution and survives resumptions.
  Outside a Worker continuation, existing synchronous adapter behavior remains.

`packages/walmart-client/src/reportContinuation.test.ts` covers resumption,
checkpoint isolation, deadline enforcement, pending/READY status handling and
429 deferral. Queue state and `sync_jobs.result_payload` should show the same
future resumption time during an operational check.

For pre-change jobs, recover the existing report request ID before restarting.
Inventory reconciliation already stores IDs in `wfs_inventory_recon_runs`.
ITEM/SEM requests created by the older Worker may require a read-only report
list lookup with exact store, report type, channel and date-range validation.
Never guess a receipt from the most recent report alone. Remove duplicate
legacy queue copies only when the same deterministic job ID exists in the
store queue, with the old Worker stopped.
