# Walmart 数据首次回填与持续增量同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Walmart ERP 建立按资源、店铺和日期窗口管理的首次历史回填与后续增量同步能力，并准确展示订单 180 天边界、10,000 条查询上限和各资源的实际覆盖范围。

**Architecture:** 在现有 API → BullMQ → Worker → MySQL 链路上增加同步计划和窗口层。资源适配器只负责 Walmart 参数、分页和响应标准化；计划器负责日期边界、拆窗、限流、重试、覆盖范围和状态；原始响应按页保存，业务表继续使用现有幂等写入。

**Tech Stack:** TypeScript, Express, BullMQ/Redis, Drizzle MySQL, React/Vite, Zod, Vitest。

**Spec:** `docs/superpowers/specs/2026-10-16-commerce-backfill-design.md`

## Global Constraints

- 订单明细只回填最近 180 天；单次查询结果最多 10,000 条；单页 `limit` 最大 200。
- 首次接入的 returns 必须探测接口实际最大回溯范围并保存覆盖结果。
- Recon 按 Walmart 返回的可用账期读取，`reconFileJson` 每页最多 1,000 条并按 `nextOffset` 到结束。
- WFS 库存日志直接接口最多查询最近 365 天；超过范围只能走报告策略或明确标记不可用。
- 业务数据按租户/店铺隔离；Walmart 业务读取保持只读；密钥不进队列和日志。
- 所有任务可独立重试，重复批次幂等，原始响应不可覆盖。
- 测试使用 Vitest，不新增 `supertest` 等测试依赖；迁移按项目约定手动应用。

## Review Focus

- 订单日期窗口结果超过 10,000 条时必须拆窗而不是继续翻页；由 Task 2 测试覆盖。
- 重复游标或报告分页异常不能死循环，已完成页可恢复；由 Task 3 测试覆盖。
- 首次回填的接口边界不能被误显示为成功覆盖；由 Task 4 测试覆盖。
- 失败窗口重试和重复批次不能重复业务行；由 Task 5 测试覆盖。
- 计划和覆盖范围必须在租户/店铺权限过滤后返回；由 Task 6 测试覆盖。

### Task 1: 同步计划、窗口和覆盖范围数据模型

**Files:**
- Create: `packages/db/src/schema/sync-plans.ts`
- Modify: `packages/db/src/schema/sync.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0022_sync_plans_and_windows.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `packages/db/src/schema/sync-plans.test.ts`

**Interfaces:**
- Produces `syncPlans`, `syncWindows`, and coverage fields that identify resource, store, mode, dates, cursor, attempts, status, and source.
- Existing `syncJobs` remains the executable attempt table and receives a `syncWindowId` reference where compatible.

- [ ] **Step 1: Write failing schema tests** for one plan per tenant/store/resource/mode, unique windows, status literals, nullable boundary dates, cursor and coverage fields.
- [ ] **Step 2: Run the focused schema test and verify it fails.**
- [ ] **Step 3: Add Drizzle tables and the hand-applied migration** with indexes on tenant/store/resource/status and a unique window key.
- [ ] **Step 4: Run the focused test and DB typecheck.**

### Task 2: Order backfill planner with 180-day and 10,000-row guards

**Files:**
- Create: `apps/worker/src/sync/orderBackfillPlanner.ts`
- Modify: `packages/walmart-client/src/adapters/orders.ts`
- Test: `apps/worker/src/sync/orderBackfillPlanner.test.ts`
- Test: `packages/walmart-client/src/adapters/orders.test.ts`

**Interfaces:**
- `planOrderWindows(input: { now: Date; oldestAllowedDays: 180; maxQueryResults: 10000; initialWindowDays: number }): OrderWindow[]`
- `refineOrderWindow(window, probe): OrderWindow[]` splits a window when Walmart reports the 10,000-result limit.
- `listOrders` always uses `limit <= 200` and exposes the response pagination metadata.

- [ ] **Step 1: Write failing tests** for the exact 180-day lower bound, 200-page limit, a 10,000-result rejection, recursive date-window splitting, and no attempt to plan an older date.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement the planner** using UTC boundaries and date-only query parameters; split by date before paging.
- [ ] **Step 4: Add order-window result metadata** so a completed window records first/last order dates and page count.
- [ ] **Step 5: Run adapter, planner, and existing order sync tests.**

### Task 3: Shared pagination, cursor safety, and rate-limit scheduling

**Files:**
- Create: `apps/worker/src/sync/windowRunner.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `packages/walmart-client/src/rateLimit.ts`
- Test: `apps/worker/src/sync/windowRunner.test.ts`

**Interfaces:**
- `runSyncWindow(windowId, handler, limiter): Promise<WindowResult>` persists page progress after every successful page.
- `assertForwardProgress(previousCursor, nextCursor)` throws on a repeated cursor.
- `retryAfterDelay(response): number` honors `Retry-After` and `x-next-replenishment-time`, capped at 120 seconds.

- [ ] **Step 1: Write failing tests** for page checkpointing, repeated cursor failure, 429/5xx backoff, and independent store limiters.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement the runner** and connect it to existing BullMQ jobs without changing business write semantics.
- [ ] **Step 4: Run queue, transport, and focused runner tests.**

### Task 4: Returns boundary discovery and incremental overlap

**Files:**
- Create: `apps/worker/src/sync/returnsBackfillPlanner.ts`
- Modify: `packages/walmart-client/src/adapters/returns.ts`
- Modify: `apps/worker/src/jobs/syncReturns.ts`
- Test: `apps/worker/src/sync/returnsBackfillPlanner.test.ts`
- Test: `apps/worker/src/jobs/syncReturns.test.ts`

**Interfaces:**
- `discoverReturnsBoundary(connection, now): Promise<{ earliestAvailable: string; evidence: string }>`
- `planReturnsIncremental(now, overlapDays = 7): DateWindow`

- [ ] **Step 1: Write failing tests** for successful old-window probing, explicit API rejection, empty-window termination, and status updates inside the overlap window.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement bounded probing** with shrinking windows and persist the actual earliest date rather than a guessed maximum.
- [ ] **Step 4: Update returns sync to use window checkpoints and idempotent writes.**
- [ ] **Step 5: Run returns and worker tests.**

### Task 5: Recon/Payment and WFS historical strategies

**Files:**
- Modify: `packages/walmart-client/src/adapters/reports.ts`
- Modify: `packages/walmart-client/src/adapters/inventory.ts`
- Modify: `apps/worker/src/jobs/syncStorageFees.ts`
- Modify: `apps/worker/src/jobs/syncInventory.ts`
- Test: `packages/walmart-client/src/adapters/reports.test.ts`
- Test: `packages/walmart-client/src/adapters/inventory.test.ts`

**Interfaces:**
- `listAvailableReconPeriods(connection): Promise<ReconPeriod[]>`
- `listReconRows(connection, period): AsyncIterable<ReconRow>` pages at 1,000 rows.
- `listWfsInventoryLog(connection, input)` accepts `startDate`, `endDate`, `offset`, `limit` and reports when the requested range exceeds 365 days.

- [ ] **Step 1: Write failing tests** for Recon period discovery, 1,000-row pagination, terminal `nextOffset`, WFS 365-day selection, and report fallback signaling.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement adapters** preserving raw page payloads and existing WFS/StorageFee normalization.
- [ ] **Step 4: Connect strategies to window plans and run storage/inventory tests.**

### Task 6: Plan API, Sync Status coverage, and manual import boundary

**Files:**
- Create: `apps/api/src/routes/sync-plans.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/sync-status.ts`
- Modify: `apps/web/src/pages/SyncStatusPage.tsx` or the existing Sync Status component
- Create: `apps/api/src/routes/sync-plans.test.ts`
- Test: `apps/web/src/pages/SyncStatusPage.test.ts`

**Interfaces:**
- `POST /api/sync/plans` accepts `{ storeId, resources, mode: "initial" | "incremental" }`.
- `GET /api/sync/plans/:id` returns status, per-resource coverage, window counts, boundary reason, and latest error.
- Historical manual import, if implemented later, reports `source: "historical_import"` and never masquerades as Walmart API coverage.

- [ ] **Step 1: Write failing API tests** for plan creation, tenant/store authorization, coverage serialization, and boundary states.
- [ ] **Step 2: Add failing frontend tests** for per-resource progress, 180-day order boundary, partial status, retry action, and empty/unauthorized states.
- [ ] **Step 3: Implement API and Sync Status presentation** using the existing authenticated fetch path and permission filtering.
- [ ] **Step 4: Run API/Web focused tests and typechecks.**

### Task 7: Initial and incremental orchestration

**Files:**
- Create: `apps/worker/src/sync/planRunner.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/sync.ts`
- Test: `apps/worker/src/sync/planRunner.test.ts`

**Interfaces:**
- `runInitialPlan(planId): Promise<PlanResult>` invokes each resource strategy and records partial/completed state.
- `runIncrementalPlans(now): Promise<PlanResult[]>` creates overlapping windows using resource policies.

- [ ] **Step 1: Write failing orchestration tests** for independent resource windows, partial failure, retry-only failed windows, and idempotent rerun.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement plan runner** with per-store concurrency limits and ordered retries.
- [ ] **Step 4: Add scheduler entry point** without changing production cadence until a runtime schedule is configured.
- [ ] **Step 5: Run all worker sync tests.**

### Task 8: End-to-end acceptance and operational record

**Files:**
- Create: `docs/superpowers/acceptance/2026-10-16-commerce-backfill.md`
- Modify: `RUNBOOK.md`
- Modify: `.superpowers/sdd/2026-10-03-walmart-erp-implementation/progress.md`

- [ ] **Step 1: Apply the numbered migration manually** to the local MySQL instance and record the migration version.
- [ ] **Step 2: Run Sandbox acceptance** for orders, returns, Recon, and WFS inventory log; record actual date ranges, page counts, and task IDs.
- [ ] **Step 3: Run production only after credentials and user-approved scope are present; do not print secrets.**
- [ ] **Step 4: Run package typechecks, focused tests, full Vitest, health checks, and `git diff --check`.**
- [ ] **Step 5: Record known limitations** including orders older than 180 days and any report strategy unavailable to the store.
