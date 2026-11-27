# ALLSKU 负责人权限应用到五模块实施计划

> **For implementation agents:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development if the user selects delegated execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 Inventory、WFS、Pricing、Advertising、Targets 全面应用 ALLSKU2026 负责人 SKU 可见范围，并保证服务端返回的明细、指标和聚合均不超出成员权限。

**Architecture:** 复用 `resolveCommerceVisibility()` 注入的 `OrderVisibility`，不引入新权限表。每个路由对管理端保持既有逻辑，对成员按 `storeId + SKU` 过滤；过滤后再做分页、汇总和派生指标。不可拆分为 SKU 的店铺级数据对成员隐藏。Targets 成员销售额走已有订单行数据源的 SKU 过滤范围，现有店铺级 target 不下发。

**Tech Stack:** Express routes, Drizzle/MySQL sources, Vitest, TypeScript。

**Design:** `docs/superpowers/specs/2026-10-17-allsku-module-visibility-design.md`

---

## Task 1: 共用 SKU 可见性纯函数与权限夹具

**Files:**
- Create: `apps/api/src/routes/sku-visibility.ts`
- Create: `apps/api/src/routes/sku-visibility.test.ts`

- [x] **Step 1: Add failing tests for exact store+SKU checks**

Cover admin pass-through, member exact visible pair, existing explicit store grant, same SKU in another store denied, empty member scope denied, and missing scope fail-closed.

- [x] **Step 2: Run focused tests and confirm RED**

Run `./node_modules/.bin/vitest run apps/api/src/routes/sku-visibility.test.ts apps/api/src/routes/commerce-visibility.test.ts`.

- [x] **Step 3: Implement a small reusable filter helper**

Add helpers that answer whether a member can view a store/SKU pair and filter row arrays. Preserve existing explicit store grants; ALLSKU-derived grants must match the exact composite `storeId + SKU` key. Admin passes through unchanged. Keep tenant resolution in existing authenticated visibility logic.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run the same Vitest command.

## Task 2: Inventory API visibility

**Files:**
- Modify: `apps/api/src/routes/inventory.ts`
- Modify: `apps/api/src/routes/inventory.test.ts`
- Modify: `apps/api/src/app.ts`

- [x] **Step 1: Add regression tests for inventory list and SKU logs**

Test visible SKU rows, unauthorized SKU row suppression, duplicate SKU across stores, and unauthorized `/inventory/:sku/logs` returning 404 without logs or order-derived summary.

- [x] **Step 2: Add tests for store-level storage fees**

Assert member receives no fee amount, rows, currency or billing period, while admin response stays unchanged.

- [x] **Step 3: Run focused tests and confirm RED**

Run `./node_modules/.bin/vitest run apps/api/src/routes/inventory.test.ts`.

- [x] **Step 4: Inject visibility and filter before calculations**

Pass the app visibility provider into Inventory. Filter current inventory rows before query filters and filter SKU logs plus their order-derived summary after validating the exact store+SKU. For members, return an explicit unavailable/null storage-fee result with no store-derived values.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run `./node_modules/.bin/vitest run apps/api/src/routes/inventory.test.ts`.

## Task 3: WFS shipment and reconciliation visibility

**Files:**
- Modify: `apps/api/src/routes/wfs.ts`
- Modify: `apps/api/src/routes/wfs.test.ts`
- Modify: `apps/api/src/app.ts`

- [x] **Step 1: Add failing WFS visibility tests**

Cover mixed shipment SKU details, shipment with no visible line, same SKU across stores, per-line shipped/received quantities, post-filter shipment totals, and member reconciliation responses without reliable SKU association.

- [x] **Step 2: Run focused tests and confirm RED**

Run `./node_modules/.bin/vitest run apps/api/src/routes/wfs.test.ts`.

- [x] **Step 3: Pass visibility into WFS router and filter**

Admin keeps existing behavior. For members, filter item arrays to visible `storeId + SKU`, omit shipments without visible SKU details, and recompute all exposed SKU-derived totals and receipt state from visible lines only. If the raw shipment item cannot be associated with a store, use the parent shipment store only when that store identity is reliable; otherwise omit it. Return no reconciliation rows unless they can be reliably connected to a visible SKU.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run `./node_modules/.bin/vitest run apps/api/src/routes/wfs.test.ts`.

## Task 4: Pricing and SEM advertising visibility

**Files:**
- Modify: `apps/api/src/routes/pricing.ts`
- Modify: `apps/api/src/routes/advertising.ts`
- Modify: `apps/api/src/routes/marketing.test.ts`
- Create: `apps/api/src/routes/marketing-visibility.test.ts`

- [x] **Step 1: Add failing route/source visibility tests**

Test Pricing base/incentive/promotion snapshots and each SEM route (`items`, `performance`, `search-terms`) filtered by exact store+SKU. Confirm all SEM row-derived metrics and result counts are calculated from filtered rows. Confirm general store/campaign advertising facts are empty for members and unchanged for admins.

- [x] **Step 2: Run focused tests and confirm RED**

Run `./node_modules/.bin/vitest run apps/api/src/routes/marketing.test.ts apps/api/src/routes/marketing-visibility.test.ts`.

- [x] **Step 3: Extend visibility provider type and apply filters**

Have route visibility carry `skus`. For each SKU-bearing route, filter source rows by the exact composite key before response metrics. For `/advertising`, return no store-level rows for members because the schema has no SKU attribution. Reject explicit unauthorized store selection with the established 403 behavior; omitted store query remains constrained by the SKU scope.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run the same Vitest command.

## Task 5: Targets member response by owned SKU

**Files:**
- Modify: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/routes/imports.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/main.ts`
- Modify: `apps/web/src/dashboard.ts`
- Modify: `apps/web/src/pages/TargetsPage.tsx`

- [x] **Step 1: Add failing tests for member and admin target summaries**

Cover month/store filtering, member completed sales computed only from visible order lines, no visible lines, member target/completion rate unavailable, and admin current `daily_facts`/sales target behavior unchanged.

- [x] **Step 2: Run focused tests and confirm RED**

Run `./node_modules/.bin/vitest run apps/api/src/routes/imports.test.ts`.

Members retain the Targets summary view but do not see store-target editing/import controls; admins retain the existing controls.

- [x] **Step 3: Inject visibility and scoped sales source**

Change the summary route wiring so authenticated members use the existing commerce order-line source filtered by month and exact visible store+SKU. Do not read tenant/store `daily_facts` for member totals. Return `target: null`, `completionRate: null` and a stable reason/availability field explaining that goals are store-level and cannot be allocated by SKU. Admin continues on the current target + daily-fact path.

- [x] **Step 4: Ensure target import endpoint scope is not broadened**

Keep existing tenant derivation. Restrict target import preview/commit, batch details, and exports to admins because they expose store-level target data that cannot be allocated to member SKUs. Keep the blank template endpoint available because it contains no business data.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run `./node_modules/.bin/vitest run apps/api/src/routes/imports.test.ts`.

## Task 6: Cross-route security acceptance

**Files:**
- Modify: relevant route tests from Tasks 2–5
- Modify: `apps/api/src/app.ts` only if wiring gaps remain

- [x] **Step 1: Exercise protected routes with authenticated visibility fixtures**

Verify no-session requests remain 401; member queries with omitted `storeId` remain scoped; explicit unassigned SKU cannot be obtained by query/path; admin responses preserve current behavior; summaries cannot reveal counts or totals from hidden rows.

- [x] **Step 2: Run impacted API tests**

Run focused suites: inventory, WFS, pricing/marketing visibility, imports, and commerce visibility.

- [x] **Step 3: Run API typecheck and diff check**

Run `node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json` and `git diff --check`.

- [x] **Step 4: Restart API and verify runtime**

After user-selected execution mode and completed implementation, restart the existing API process using the repository's persistent service convention; verify `GET http://localhost:3000/api/health` returns 200 and exercise one authorized and one unauthorized member scope without exposing credentials.

## Notes

- Do not touch the unrelated pre-existing changes in this worktree.
- Do not add database migrations or dependencies.
- Do not log, print or expose session secrets or Walmart credentials.
- Do not report completion until tests, typecheck, diff check and API health evidence are collected.

## Execution Record

- API tests: 27 files, 82 tests passed.
- API and Web TypeScript checks passed; `git diff --check` passed.
- Persistent API screen restarted; port 3000 is served by PID 48852 and `GET /api/health` returned 200.
- Independent scoped review found no critical or important authorization issue. Targets role-specific editor visibility lacks a dedicated frontend test; API authorization is independently enforced and covered by route tests.
