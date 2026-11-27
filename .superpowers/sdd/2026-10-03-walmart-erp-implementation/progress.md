# SDD ledger — plan: /Users/carl/Documents/wmterp/docs/superpowers/plans/2026-10-03-walmart-erp-implementation.md

## Preflight scan

| Item | Finding | Ruling |
|---|---|---|
| Plan repository | ERP plan is outside the new walmart-erp repository; the implementation workspace is the separate /Users/carl/Documents/wmterp/walmart-erp Git repository. | Use the absolute plan path as authority; keep plan/spec documents in the parent workspace. |
| Existing WMT API | Existing WMT API repository has unrelated uncommitted changes. | Do not modify or commit there. |
| Task 1 -> Task 2 | Task 1 creates workspace/package scripts consumed by Task 2. | Sequential implementation. |
| Task 2 -> Task 3 | Task 2 config/testkit consumed by DB integration tests. | Sequential implementation. |
| Task 3 -> Task 4 | Task 3 schema/repositories consumed by auth/scope routes. | Sequential implementation. |
| Task 4 -> Task 5 | Task 4 auth and store connection route consumed by Connector integration. | Sequential implementation. |
| Task 5 -> Task 6 | Task 5 read-only Connector is the only Walmart transport for Worker. | Sequential implementation. |
| Task 6 -> Task 7 | Task 6 sync status endpoints consumed by web shell. | Sequential implementation. |
| Task 8 -> Task 9 | Item/SKU scope data is consumed by order-line visibility. | Sequential implementation. |
| Task 9 -> Task 10 | Order/return facts feed dashboard and inventory-independent modules. | Sequential implementation. |
| Task 10 -> Task 11 | Inventory/WFS facts feed overview risk cards. | Sequential implementation. |
| Task 11 -> Task 12 | Dashboard metric contracts feed pricing/advertising performance views. | Sequential implementation. |
| Task 12 -> Task 13 | Operational hardening covers all preceding adapters and jobs. | Sequential implementation. |
| Global constraint | Walmart resource methods are GET-only; token POST is authentication-only. | Enforce at Connector and release-contract layers. |
| Global constraint | MySQL 8, tenant scope, immutable raw payloads, server-side visibility. | Carry into all task briefs/reviews. |

## Todo

- [x] Task 1
- Task 1: complete (commit 90a6b0b; spec review PASS; quality review PASS; local review recorded in task-1-review.md)
- [x] Task 2
- Task 2: complete (commit e5ebf43; `pnpm --filter @walmart-erp/config --filter @walmart-erp/testkit test` 7/7; `pnpm test` passed; `pnpm typecheck` 8/8; `docker compose config` passed)
- [x] Task 3
- Task 3: complete (commit 6e4d5ee; Schema tests 2/2; MySQL 8.4/Redis healthy; migration applied twice successfully; 17 tables verified)
- [x] Task 4
- Task 4: complete (commit 74b2821; Domain 3/3 and API 2/2 tests; full typecheck passed)
- [x] Task 5
- Task 5: complete (commit 9d8483d; connector tests 5/5; all typechecks passed; fake fetch only)
- [x] Task 6
- Task 6: complete (Worker queue, retry policy, sync entrypoints, aggregate helper and API sync route; worker tests 3/3; worker/API typechecks passed)
- [x] Task 7
- Task 7: complete (formal acceptance 2026-10-15: API health returned 200 with `requestId/data/error`; unauthenticated Dashboard, Items, Orders, Members, Inventory and Sync Health returned 401 standard envelopes; authenticated admin login, `/api/auth/me`, Dashboard data and API-restart cookie session verified; browser refresh remained on Dashboard; member navigation hides Members/Stores and admin navigation retains them; Dashboard freshness/estimated-state tests passed; focused API/Web acceptance tests 21/21 and API/Web typechecks passed).
- [x] Task 8
- Task 8: complete (commits b14897e, cfc29e6, 19d8f70, 248d707, 5d81995; final independent review PASS; API/Worker typecheck and focused route/sync tests passed)
- [x] Task 9
- Task 9: complete (code/review gate; commits 822c6fa..d7fc4e4; authoritative review task-9-review-round2.md PASS; worker 20/20 and API 27/27 reported, four typechecks reported).
- [x] Task 10
- Task 10: complete (formal acceptance 2026-10-15: inventory/WFS focused tests 27/27; inventory snapshots 660 and WFS inventory logs 775 in local MySQL; raw WFS resources persisted; duplicate snapshot/log key checks 0; reconciliation one-hour interval and Walmart read-only contract passed; full release gate remains separate).
- [x] Task 11
- Task 11: complete (formal acceptance 2026-10-15: dashboard/domain/aggregate/import/visibility focused tests 27/27; `daily_facts` backup has 88 rows, governance record reports 0 duplicate groups and 88 rows after cleanup, current duplicate-key query 0, and current/backup key mismatch 0; target import/summary tables are tenant-scoped and local target row is present; full release gate remains separate).
- [x] Task 12
- Task 12: complete (Walmart read-only pricing, advertising and performance adapters; MySQL snapshots and Worker sync jobs; tenant/store-scoped APIs and pages; Sync Status controls; focused tests and typechecks passed)
- Task 12 extension: onsite advertising and SEM are separate channels; SEM campaign performance uses the approved read-only report POST `/v3/advertising/sem/campaigns/performance-summary`, with independent sync controls and API filtering.
- [ ] Task 13
- [ ] Task 7-13 最终验收（历史 28 项测试记录不等于全部任务验收）
- 验收：全量 Vitest 28/28、API/Worker/Web TypeScript 检查通过，git diff --check 通过（2026-10-04）

Ruling: Continue in the current checkout for Task 8 because it contains in-flight, verified credential and environment changes needed by the running local API and Sandbox connection; an isolated worktree would omit those uncommitted prerequisites.

Task 9: fix round 2/5 in progress — base 7ba65a3; authoritative review task-9-review-fix.md. Remaining: queue-to-database dispatch, repeated status transitions, explicit PII grants, SKU-cohort match, named date basis, status filter and pagination. Original implementer resumed.

Task 9: fix round 2/5 complete — 7 addressed, 0 open Critical/Important; review task-9-review-round2.md.
Task 9: service verification — real Redis enqueue/consume passed using isolated queue; customer_field_grants migration applied and table confirmed. See task-9-round2-service-checks.md.
Release gate still open: full real Redis + MySQL writer/reader + Walmart Sandbox end-to-end sync. Do not describe production acceptance as complete.

## 2026-10-05 生产样本后重新打开 Task 9

历史独立复审仅覆盖当轮差异，不代表生产验收。生产只读样本已入 raw_payloads（1 条订单、5 条退货），本地接口读取通过。现有阻塞：真实退款金额字段未适配；分页仅读取顶层 nextCursor，实际响应订单为 list.meta.nextCursor、退货为 meta.nextCursor，存在漏页风险；真实队列端到端尚未验证。Task 9 未完成，Task 10 尚未启动。

Task 9 production repair: nested Walmart cursors and return chargeTotals amount parsing fixed; focused tests 13/13 and production probe orders 200/1, returns 200/5. Full historical sync remains separate acceptance.

## 2026-10-15 Task 13 continuation

- Added `packages/db/src/retention-cli.ts`: default dry-run reports UTC cutoffs and candidate counts; execution requires `--execute`, `--operator`, and `--backup-id`, deletes only raw payloads past `received_at` and terminal sync jobs past `created_at`, and records actual counts in `audit_events` in the same transaction. No purge was executed.
- Added `ops/monitoring/check-sync-health.sh` and documented the polling thresholds in `RUNBOOK.md`. The script is not scheduled or connected to an external notification destination yet; operator token rotation and alert delivery still need deployment configuration.
- Fresh checks: 46 Vitest files / 151 tests passed; workspace typecheck and lint, read-only contract (20 source files), production dependency audit, Compose config, Drizzle migration check, API health, monitoring script normal/alert paths, DB package typecheck, monitoring script `bash -n`, and `git diff --check` passed. Retention dry-run against local MySQL reported 0 raw-payload and 0 sync-job candidates; no deletion was executed.
- Remaining deployment work: schedule `ops/monitoring/check-sync-health.sh` and connect its nonzero exit to the operator's alert destination; run the reviewed encrypted backup/restore drill in the target environment. Task 13 remains open until those deployment-level gates are evidenced.
- Added `ops/monitoring/run-sync-health-check.sh` and `sync-health.cron.example`: cron runs every 15 minutes with `flock`, loads a mode-600 secret file, and keeps the bearer token out of the crontab. Wrapper syntax, missing-env rejection, and diff checks passed. The example is not installed on a host and does not itself deliver notifications.
- Added `scripts/task13-release-gate.sh` and root `release:gate`; the complete code gate ran successfully: smoke test, 46 Vitest files / 151 tests, workspace typechecks, lint, read-only contract, production audit, migration check, Compose validation, API health and diff check. Deployment installation and encrypted backup/restore remain environment operations.
- Backup scripts pass `bash -n`; backup Compose passes with explicitly supplied placeholder configuration values. No backup or restore was run because this checkout has no authorized age recipient/identity or isolated restore target; production-looking targets remain rejected by the restore script.
- Current environment check: API, Web and exactly one Worker are present in detached screen sessions; MySQL and Redis are healthy. `.env.runtime` has no backup recipient/password/identity entries and no encrypted snapshot or isolated restore target is available, so deployment backup/restore remains blocked on environment-owned inputs.
- Decision: no deployment server or backup key material is currently available. Keep Task 13 open as `code gate complete / deployment acceptance deferred`; do not create placeholder production credentials or claim backup/restore completion. Resume the deployment checklist only when an authorized server operator supplies the isolated target and secret-manager inputs.

## 2026-10-16 首次回填与增量同步计划

- Added `docs/superpowers/specs/2026-10-16-commerce-backfill-design.md` and `docs/superpowers/plans/2026-10-16-commerce-backfill.md`.
- Implemented sync plans/windows, order 180-day/10,000-result/200-page planning, Returns boundary probing, Recon 1,000-row paging, WFS inventory-log date bounds, plan API/Sync Status coverage, and initial/incremental orchestration.
- Applied local MySQL migration `0022_sync_plans_and_windows.sql`; `sync_plans`, `sync_windows`, `sync_jobs.sync_window_id` and indexes verified.
- Fresh verification: full Vitest 61 files / 195 tests, all 8 workspace typechecks, API/Web health 200, `git diff --check` passed.
- Production and Sandbox full backfill were not run: no approved execution window/Sandbox credentials were supplied. Orders older than 180 days remain an explicit Walmart API boundary.

## 2026-10-21 ALLSKU 月度 SKU 目标初始化

- Added `docs/superpowers/specs/2026-10-21-allsku-monthly-target-initialization-design.md` and implementation plan `docs/superpowers/plans/2026-10-21-allsku-monthly-target-initialization.md`.
- Added migration `0029_monthly_sku_targets.sql` with `target_batches` and `sku_target_rows`; applied manually to the local MySQL database after detecting pre-existing migration tables.
- Added natural-month target calculation, idempotent initialization/read/preview/finalize APIs, server-side permission filtering, and finalized store/month summary updates.
- Added formula-bearing monthly XLSX export and server-side recalculation preview; preserved legacy target import/export.
- Targets page now exposes admin-only month initialization, batch status, SKU details, formula export, preview upload and finalize controls.
- Verification: monthly API/calculation/XLSX/DB suites 12/12, broader related Web/API suites 43/43, API/Web/DB typechecks, migration table checks, local draft initialization, XLSX export and preview, API/Web health 200, and `git diff --check` passed.
