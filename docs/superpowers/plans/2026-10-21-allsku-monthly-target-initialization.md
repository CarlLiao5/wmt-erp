# ALLSKU2026 Monthly SKU Target Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate monthly SKU target drafts from ALLSKU2026, calculate targets from prior-month orders and current inventory, export editable Excel formulas, and finalize validated revisions in Targets.

**Architecture:** Add a tenant-scoped monthly target batch and SKU detail model. A pure calculation module consumes ALLSKU mappings, prior-month order aggregates, and latest inventory snapshots; API routes persist immutable draft snapshots and expose initialize/read/export/preview/finalize. The existing Targets UI gains month initialization and draft/finalized workflow while existing store/month summary remains compatible.

**Tech Stack:** TypeScript, Express, Drizzle ORM, MySQL, React/Vite, ExcelJS, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-allsku-monthly-target-initialization-design.md`

## Global Constraints

- Use `America/Los_Angeles` for order month attribution and natural-month boundaries.
- Use `上月日均销量 = 上月销量 / 上月自然日天数`.
- Use `销售天数 = MIN(本月天数, 在库库存 / 预计日销)` and `数量目标 = 销售天数 * 预计日销`.
- Use `金额目标 = 上月均价 * 数量目标`; missing values remain missing and are never fabricated as zero.
- Enforce tenant and store + SKU visibility on the server before aggregation; only admins may initialize, import, finalize, or edit.
- Preserve existing target import preview/validate/commit behavior and MySQL migration conventions; do not add test dependencies.
- Keep raw order/inventory data unchanged; target batches are idempotent and auditable.

## Review Focus

- Duplicate initialization for a month must return the existing draft/finalized batch without creating a second batch. Test in Task 3.
- SKUs with no orders or no inventory must remain visible with explicit missing reasons and no fake zero price/target. Test in Task 2.
- Store/SKU permission filtering must happen before order and inventory aggregation. Test in Task 3 and Task 5.
- Excel formulas must survive export and be recalculated from edited expected daily sales during preview. Test in Task 4.
- A finalized batch must reject ordinary overwrite and require an explicit admin revision. Test in Task 3.

### Task 1: Database schema and migration

**Files:**
- Create: `packages/db/src/schema/sku-targets.ts`
- Create: `packages/db/migrations/0029_monthly_sku_targets.sql`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/schema.test.ts`

**Interfaces:**
- Produces Drizzle tables `targetBatches` and `skuTargetRows` with tenant, month, batch status, source snapshot, formula version, SKU metadata, calculation inputs/results, missing reasons, and timestamps.
- Unique scope: one active batch per tenant/month; one detail row per batch/store/SKU.

- [ ] **Step 1: Write schema tests** asserting table names, required columns, unique constraints, and `draft/finalized/superseded` status representation.
- [ ] **Step 2: Run `node_modules/.bin/vitest run packages/db/src/schema/schema.test.ts` and verify the new assertions fail.**
- [ ] **Step 3: Implement the tables and migration** with decimal precision matching existing money/quantity conventions, indexes for tenant/month and batch/store/SKU, and no destructive changes.
- [ ] **Step 4: Run the schema test and `git diff --check`; expect PASS.**

### Task 2: Pure monthly target calculation

**Files:**
- Create: `apps/api/src/routes/monthlyTargets.ts`
- Create: `apps/api/src/routes/monthlyTargets.test.ts`

**Interfaces:**
- Produces `calculateMonthlySkuTarget(input: MonthlyTargetInput): MonthlyTargetCalculation`.
- Input includes target month, ALLSKU row metadata, prior-month units/revenue, prior-month natural days, latest available inventory, and `formulaVersion`.
- Output includes `lastMonthAvgDailySales`, `lastMonthAvgPrice`, `expectedDailySales`, `sellingDays`, `quantityTarget`, `amountTarget`, and `missingReasons`.

- [ ] **Step 1: Write failing tests** for normal calculation, month length 28/29/30/31, inventory cap, zero sales, missing inventory, and missing price.
- [ ] **Step 2: Run the focused Vitest file and verify failure.**
- [ ] **Step 3: Implement the pure calculation** using finite non-negative numbers, natural calendar days, `MIN`, and null/missing values instead of fabricated zeros.
- [ ] **Step 4: Run the focused Vitest file and verify PASS.**

### Task 3: Initialization, batch read, preview, and finalize APIs

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/routes/sku-visibility.ts` (only shared query helper additions if needed)
- Test: `apps/api/src/routes/monthlyTargets.test.ts`

**Interfaces:**
- `POST /api/targets/initialize { month }` returns an existing active batch or creates a draft.
- `GET /api/targets/:batchId` returns visible detail rows and batch summary.
- `POST /api/targets/:batchId/preview` accepts editable rows and returns row errors plus recalculated values.
- `POST /api/targets/:batchId/finalize` commits the validated batch and updates compatible `sales_targets` summaries.

- [ ] **Step 1: Add route tests** for admin authorization, idempotent initialization, ALLSKU store/SKU matching, order aggregation by Pacific month, inventory lookup, member visibility, preview validation, and finalized-batch protection.
- [ ] **Step 2: Run the focused tests and verify failure.**
- [ ] **Step 3: Implement MySQL sources** using `smartSheetAllSkuRows`, `orders/orderLines`, and latest inventory rows; filter tenant and visible store/SKU before aggregation; persist a source snapshot timestamp and formula version.
- [ ] **Step 4: Implement the four routes** with transaction boundaries, batch status checks, and explicit missing-data summaries.
- [ ] **Step 5: Run route tests and API typecheck; expect PASS.**

### Task 4: XLSX export and import preview with formulas

**Files:**
- Modify: `apps/api/src/routes/xlsx.ts`
- Modify: `apps/api/src/routes/imports.ts`
- Test: `apps/api/src/routes/xlsx.test.ts`

**Interfaces:**
- `targetMonthlyWorkbook(rows)` writes the approved columns and formula cells for quantity and amount targets.
- `parseMonthlyTargetWorkbook(buffer)` returns typed rows plus formula/result metadata without treating formula text as a trusted database value.

- [ ] **Step 1: Write failing XLSX tests** for required headers, formula strings, editable expected daily sales, formula result handling, and malformed/non-negative validation.
- [ ] **Step 2: Run the focused XLSX tests and verify failure.**
- [ ] **Step 3: Implement export/import helpers** with ExcelJS, stable column positions, formula cells `=销售天数*预计日销` and `=上月均价*数量目标`, and explicit editable-column allowlist.
- [ ] **Step 4: Connect batch export and preview endpoints; recalculate server-side from parsed editable values.**
- [ ] **Step 5: Run XLSX tests, route tests, and API typecheck; expect PASS.**

### Task 5: Targets page workflow

**Files:**
- Modify: `apps/web/src/pages/TargetsPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/pages/TargetsPage.test.ts`

**Interfaces:**
- Month selector, initialize button, batch status, summary counts, export button, XLSX upload/preview, finalize button, and admin edit controls consume the Task 3 endpoints.
- Existing Targets summary cards and store/month filters remain available and use finalized data.

- [ ] **Step 1: Write failing UI tests** for initialization, draft display, export trigger, preview errors, finalize enablement, and non-admin read-only state.
- [ ] **Step 2: Run the focused Web tests and verify failure.**
- [ ] **Step 3: Implement the workflow** with explicit loading/error/empty states and a compact table showing owner, SKU, inventory, prior-month metrics, expected daily sales, selling days, and targets.
- [ ] **Step 4: Add responsive styles and formula/edit affordances without adding a separate navigation page.**
- [ ] **Step 5: Run Web tests and Web typecheck; expect PASS.**

### Task 6: End-to-end verification and runtime rollout

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-allsku-monthly-target-initialization-design.md` only if implementation clarifies a rule.
- Modify: `.superpowers/sdd/2026-10-03-walmart-erp-implementation/progress.md`

- [ ] **Step 1: Apply migration `0029` to the local MySQL database and verify the tables/indexes.**
- [ ] **Step 2: Run focused API/Web/DB Vitest suites, both typechecks, and `git diff --check`.**
- [ ] **Step 3: Restart API and Web persistent screen sessions, then verify `/api/health` and the Targets page in the browser.**
- [ ] **Step 4: Run one local draft initialization for a non-production test month/tenant, verify formula-bearing XLSX export, preview an adjusted expected daily sales value, and finalize only if the resulting rows match the formula.**
- [ ] **Step 5: Update the implementation ledger with migration, endpoint, formula, and verification evidence.**
