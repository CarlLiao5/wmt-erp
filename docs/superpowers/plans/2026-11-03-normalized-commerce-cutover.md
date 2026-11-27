# 订单、退货与 Payment 标准化入库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将旧订单/退货明细完整迁入可索引的业务表，让 worker 直接标准化写入、API 使用 SQL 过滤与分页，并把 Recon Payment 明细从 JSON 解析改为标准化查询。

**Architecture:** 为现有标准表增加旧表中缺少的业务字段并补充分店/日期/外键索引；用幂等回填将 `orders old`、`order_items`、`returns` 映射到标准表。Worker 的订单、退货、Recon 路径直接 upsert 标准数据，raw JSON 仅作归档；API 路由由 SQL 返回筛选、统计和分页数据。

**Tech Stack:** TypeScript, Express, Drizzle MySQL, mysql2, Vitest, Walmart API adapters。

**Spec:** `docs/superpowers/specs/2026-11-03-normalized-commerce-cutover.md`

## Global Constraints

- 不删除旧源表、raw payload 或当前标准表；只有对账通过并经单独决定后才清理旧表。
- 店铺名“鑫起典沃尔玛”映射至店铺 ID `10002512034`，其余店铺需精确映射。
- 旧订单行中 102 个额外 PO 键需在回填报告中解释，不可静默跳过或伪造 Walmart 主单数据。
- 3 条缺 SKU 退货仍需保留，并作为缺 SKU 记录可查询。
- 所有查询及写入必须包含 tenant/store scope；保持订单客户字段现有脱敏策略。
- 重复历史回填或 API 同步必须幂等；raw JSON 不得成为业务列表热路径依赖。
- Payment 报告原始归档保留；交易行和仓储费用从标准化 Recon 行读写。

## Review Focus

- 同一 PO 跨店铺相同编号：唯一键必须包含 store/tenant；由 Task 1/2 测试覆盖。
- 商品行重复/缺父单：回填按行键幂等并显式报告缺失父单；由 Task 2 测试覆盖。
- 旧日期或 Walmart ISO 日期时区：回填及 API Pacific 日期边界一致；由 Task 3/4 测试覆盖。
- 空 SKU 退货：不能因非空约束丢弃；由 Task 1/2 测试覆盖。
- Worker 状态更新与部分字段缺失：缺省值不能覆盖已有有效值；由 Task 3 测试覆盖。

---

### Task 1: 扩充标准业务 schema 与迁移

**Files:**
- Modify: `packages/db/src/schema/orders.ts`
- Modify: `packages/db/src/schema/return-records.ts`
- Create: `packages/db/src/schema/recon-transactions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0038_normalized_commerce_fields.sql`
- Test: `packages/db/src/schema/schema.test.ts`

**Interfaces:**
- Produces expanded orders/orderLines/returnRecords rows preserving legacy order, product, return, and fulfillment fields.
- Produces `reconTransactions` keyed by stable report/store/transaction identity with amount, currency, date, description and source metadata.

- [ ] **Step 1: Write failing schema tests** asserting the added legacy fields, nullable SKU on returns, stable unique/index definitions, and Recon transaction fields.
- [ ] **Step 2: Run DB focused tests** and verify they fail for missing schema properties.
- [ ] **Step 3: Add additive Drizzle schema and hand-authored migration**; preserve existing tables and rows.
- [ ] **Step 4: Run DB tests and typecheck.**

### Task 2: Dry-run and idempotent legacy backfill

**Files:**
- Create: `scripts/backfill-commerce-legacy.ts`
- Create: `scripts/backfill-commerce-legacy.test.ts`
- Modify: `package.json`
- Modify: `packages/db/src/schema/orders.ts` only if Task 1 review finds a missing mapped field.

**Interfaces:**
- `planLegacyCommerceRows(input)` maps the three old tables into deterministic standard order, line and return rows and returns explicit mapping anomalies.
- CLI supports `--dry-run` by default and requires an explicit `--apply` to write; it reports per-store/date/source/target counts and the 102 extra PO keys.
- `--apply` uses bounded transactions and deterministic IDs/upsert keys; no deletes or truncates.

- [ ] **Step 1: Write failing mapper tests** for the five store aliases, order and line relationships, duplicate safety, null-SKU returns, missing parent POs and currency/amount preservation.
- [ ] **Step 2: Run script tests** and verify they fail before mapper implementation.
- [ ] **Step 3: Implement pure mapping and dry-run report** without database writes.
- [ ] **Step 4: Test against sanitized fixture rows** and run production `--dry-run`; do not write during this step.
- [ ] **Step 5: Review dry-run totals and anomaly samples, then run explicit production apply** using one transaction-safe batch protocol and record counts.
- [ ] **Step 6: Reconcile source and target totals** by store/date/SKU and mark the task complete only when every mismatch is explained.

### Task 3: Complete normalized order and return worker writes

**Files:**
- Modify: `apps/worker/src/jobs/syncOrders.ts`
- Modify: `apps/worker/src/jobs/syncReturns.ts`
- Modify: `apps/worker/src/jobs/commerceRawStore.ts`
- Test: `apps/worker/src/jobs/syncOrders.test.ts`
- Test: `apps/worker/src/jobs/syncReturns.test.ts`
- Test: `apps/worker/src/jobs/commerceRawStore.test.ts`

**Interfaces:**
- Order/return normalizers expose every selected API field available on Walmart payloads and return absent optional fields as `undefined`.
- DB writer upserts each normalized object into its standard master/line/return row; raw archive remains a separate audit write.

- [ ] **Step 1: Add failing adapter/DB-writer tests** for legacy fields, state/refund updates, replay idempotency, partial payloads preserving existing values, and raw-archive separation.
- [ ] **Step 2: Run focused worker tests and verify failure.**
- [ ] **Step 3: Implement normalization and upsert semantics** with nullable optional API fields and deterministic store-scoped keys.
- [ ] **Step 4: Run order, return, raw-store and commerce flow test suites.**

### Task 4: Move order and return API reads to SQL

**Files:**
- Modify: `apps/api/src/routes/commerce-source.ts`
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/routes/returns.ts`
- Test: `apps/api/src/routes/commerce-source.test.ts`
- Test: `apps/api/src/routes/order-contracts.test.ts`
- Test: `apps/api/src/routes/orders.test.ts`

**Interfaces:**
- `listOrdersPage` and `listReturnsPage` take tenant/store/date/filter/sort/page inputs and return rows plus SQL aggregates and counts.
- `listReturnSnapshots` reads normalized return status events; it does not parse `raw_payloads` on page load.

- [ ] **Step 1: Add failing API/source tests** proving SQL paging/filtering, Pacific-day bounds, member store scoping, null-SKU handling, and normalized history behavior.
- [ ] **Step 2: Run focused API tests and verify failure.**
- [ ] **Step 3: Implement SQL queries and indexes-backed filters**; remove raw JSON loading from order/return request paths.
- [ ] **Step 4: Run API route and commerce source suites plus API typecheck.**

### Task 5: Normalize Recon Payment transactions

**Files:**
- Modify: `apps/worker/src/jobs/syncStorageFees.ts`
- Modify: `packages/walmart-client/src/adapters/storageFees.ts`
- Modify: `apps/api/src/routes/inventory.ts`
- Test: `apps/worker/src/jobs/syncStorageFees.test.ts`
- Test: `packages/walmart-client/src/adapters/storageFees.test.ts`
- Test: `apps/api/src/routes/inventory.test.ts`

**Interfaces:**
- `normalizeReconTransactions(payload, context)` returns transaction rows with stable identity, store, month/business date, description, amount, currency and source ID.
- Worker writes each transaction row idempotently; storage-fee aggregation and period metadata query standard transaction rows only.

- [ ] **Step 1: Add failing tests** for multiple nested recon payload shapes, transaction identity, pagination overlap, negative/zero amounts, and storage-fee period lookup without JSON parsing.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement normalized Recon persistence** while retaining raw report archive.
- [ ] **Step 4: Run Payment/Recon worker, adapter and inventory API tests.**

### Task 6: Production verification and operational notes

**Files:**
- Modify: `RUNBOOK.md`
- Create: `docs/superpowers/acceptance/2026-11-03-normalized-commerce-cutover.md`

- [ ] **Step 1: Apply migration and run dry-run reconciliation** against production; do not start writes if store or parent-order mappings remain unexplained.
- [ ] **Step 2: Backfill production standard tables** in bounded, repeatable batches; capture counts and failures without customer PII.
- [ ] **Step 3: Verify source/target totals, query plans, tenant scope, and route timings**; inspect EXPLAIN for date/store list routes.
- [ ] **Step 4: Switch API and worker only after reconciliation passes; preserve old table and raw archive for rollback.**
- [ ] **Step 5: Run focused and full tests, package typechecks, health checks, and `git diff --check`; record results and residual API limits.**

## Execution note

Production backfill writes are authorized by the user, but table deletion is out of scope for this plan. No legacy or current table is dropped. A separate cleanup requires successful reconciliation and a separately reviewed cleanup plan.
