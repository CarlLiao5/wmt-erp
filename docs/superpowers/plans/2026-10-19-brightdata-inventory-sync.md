# Bright Data 商品库存同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 WBKC Bright Data 商品采集器接入 ERP，同步到独立数据表，并提供全员可见的面板、产品管理和旧库迁移能力。

**Architecture:** 在现有 ERP MySQL 中新增三张独立 Bright Data 表；Worker 通过现有同步队列调用 Bright Data Web Unlocker；API 和 Web 增加一个“面板”入口，内部切换库存看板与产品管理。Bright Data 数据不应用负责人、店铺或 SKU 权限过滤。

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, MySQL, BullMQ/Redis, Vite, Vitest, Bright Data Web Unlocker API。

**Spec:** `docs/superpowers/specs/2026-10-19-brightdata-inventory-sync-design.md`

## Global Constraints

- 不新建数据库，使用当前 ERP MySQL 数据库。
- 不改写现有 `items`、`inventory` 业务表。
- Bright Data 面板对所有已登录用户开放完整数据，不应用负责人、店铺或 SKU 权限过滤。
- 旧项目字段语义保持兼容，库存未知时存储 NULL，不写成 0。
- Bright Data 凭证只从服务端环境变量读取，不写入数据库或前端。
- 4xx 失败直接记录并继续；网络错误和 5xx 按 5、10 秒退避重试。

## Review Focus

- 旧库重复迁移：以源表标识和幂等键避免重复写入，测试重复执行结果不增加。
- Item ID 缺失或重复：同步前去重，空 Item ID 不发起请求，测试统计准确。
- Bright Data 返回空 HTML 或无库存字段：成功解析但 `available_quantity` 为 NULL，测试不误报为 0。
- Bright Data 4xx/5xx：4xx 不重试，5xx/网络错误最多重试 3 次，测试运行统计。
- 全员面板权限：普通成员和管理员读取相同租户范围的 Bright Data 数据，测试不走现有 SKU 过滤。

### Task 1: Add independent Bright Data database schema and migration

**Files:**
- Create: `packages/db/src/schema/brightdata.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0026_brightdata_inventory.sql`
- Create: `packages/db/src/schema/brightdata.test.ts`

**Interfaces:**
- Produces Drizzle tables `brightdataItemNames`, `brightdataProductInventory`, `brightdataRunHistory` and indexes/unique keys used by later tasks.

- [ ] **Step 1: Write failing schema tests** asserting table names, nullable inventory quantity, unique tenant/item identity, run status fields, and snapshot indexes.
- [ ] **Step 2: Run `pnpm --filter @walmart-erp/db test -- brightdata.test.ts` and verify failure.**
- [ ] **Step 3: Implement the three Drizzle schemas and export them from `schema/index.ts`.** Keep legacy column names represented by explicit mapped column names where migration compatibility requires it.
- [ ] **Step 4: Add the MySQL migration and run schema tests.**
- [ ] **Step 5: Run `pnpm --filter @walmart-erp/db typecheck` and `git diff --check`.**

### Task 2: Implement Bright Data client and Worker job

**Files:**
- Create: `packages/walmart-client/src/adapters/brightdata.ts`
- Modify: `packages/walmart-client/index.ts`
- Create: `apps/worker/src/jobs/syncBrightData.ts`
- Modify: `apps/worker/src/sync.ts`
- Modify: `apps/worker/src/queue.ts`
- Create: `apps/worker/src/jobs/syncBrightData.test.ts`

**Interfaces:**
- Consumes: Bright Data env vars and Task 1 tables.
- Produces: `syncBrightDataInventory(tenantId: string, runId: string): Promise<{ total: number; success: number; failed: number }>` and resource key `brightdata-inventory`.

- [ ] **Step 1: Write failing tests** for request body `{ zone, url, format: 'raw' }`, parsing product name/quantity/price/rating/review count, NULL quantity, and retry classification.
- [ ] **Step 2: Run the focused Worker/client tests and verify failure.**
- [ ] **Step 3: Implement the Bright Data adapter** with timeout, 3-second interval configuration, 4xx no-retry behavior, and 5xx/network backoff.
- [ ] **Step 4: Implement the Worker job** with source item de-duplication, append-only snapshot writes, idempotency, and run history updates.
- [ ] **Step 5: Register the resource in the queue/sync dispatch and run focused tests.**

### Task 3: Add API and Sync Status integration

**Files:**
- Create: `apps/api/src/routes/brightdata.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/routes/sync-status.ts`
- Create: `apps/api/src/routes/brightdata.test.ts`

**Interfaces:**
- Produces `GET /api/brightdata/inventory`, `GET /api/brightdata/items`, and `POST /api/sync` resource support for `brightdata-inventory`.
- Bright Data reads use tenant scope but skip member SKU/store filtering by design.

- [ ] **Step 1: Write failing route tests** for paginated inventory/items reads, all-authenticated-user visibility, and sync job creation.
- [ ] **Step 2: Run focused API tests and verify failure.**
- [ ] **Step 3: Implement read routes** with filters for Item ID, product name, date range, and pagination.
- [ ] **Step 4: Register sync resource and expose run statistics in Sync Status.**
- [ ] **Step 5: Run API typecheck and focused tests.**

### Task 4: Add dashboard and product management views

**Files:**
- Create: `apps/web/src/pages/BrightDataPanel.tsx`
- Modify: `apps/web/src/main.ts`
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/src/pages/BrightDataPanel.test.ts`

**Interfaces:**
- Consumes Task 3 endpoints.
- Produces one navigation item “面板” with internal tabs “库存数据看板” and “产品管理”.

- [ ] **Step 1: Write failing UI tests** for one nav entry, tab switching, search/filter controls, pagination, and full authenticated data rendering.
- [ ] **Step 2: Run focused Web tests and verify failure.**
- [ ] **Step 3: Implement the inventory dashboard** with dark product cards, orange inventory, green rating, blue price, latest snapshot values, and trend placeholders/series.
- [ ] **Step 4: Implement the product management table** with search, category filter, pagination, and empty/loading/error states.
- [ ] **Step 5: Add responsive styles and run Web typecheck/tests.**

### Task 5: Add legacy database migration utility

**Files:**
- Create: `scripts/migrate-brightdata-legacy.ts`
- Create: `scripts/migrate-brightdata-legacy.test.ts`
- Modify: `README.md` or add `docs/runbooks/brightdata-migration.md`

**Interfaces:**
- Produces a dry-run and apply CLI accepting source and destination MySQL URLs, with row-count/time-range validation and idempotent inserts.

- [ ] **Step 1: Write failing migration tests** for column mapping, NULL handling, duplicate reruns, and validation failure.
- [ ] **Step 2: Run focused migration tests and verify failure.**
- [ ] **Step 3: Implement dry-run/apply modes** for `item_names`, `product_inventory`, and `run_history` into the three new tables.
- [ ] **Step 4: Add migration documentation** with backup, dry-run, apply, and verification commands.
- [ ] **Step 5: Run migration tests and script syntax checks.**

### Task 6: End-to-end verification and service rollout

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-brightdata-inventory-sync-design.md` only if behavior changes during implementation.

- [ ] **Step 1: Run DB migration checks on an empty database and an existing development database.**
- [ ] **Step 2: Run API, Worker, Web, and Walmart client typechecks plus focused tests.**
- [ ] **Step 3: Verify the Bright Data sync job appears in Sync Status and completes with a mocked response.**
- [ ] **Step 4: Restart API, Worker, and Web; verify `/api/health` and `http://localhost:5173/`.**
- [ ] **Step 5: Record row counts and migration verification results for the eventual old-database migration.**
