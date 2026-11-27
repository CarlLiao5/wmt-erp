# 企微智能文档头程综合同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将企业微信智能文档的头程在途记录通过租户级综合同步按钮完整落库到 ERP；店铺名称只做可选关联，匹配不到也不丢行、不终止批次。

**Architecture:** 新增租户级企微 Bot 配置、头程在途标准化表和 MCP 客户端。API 继续只负责鉴权与入队，Worker 负责 MCP 分页、原始响应持久化、店铺可选匹配和幂等 upsert；Sync Status 增加一个综合同步按钮。

**Tech Stack:** TypeScript, Express, BullMQ/Redis, Drizzle MySQL, Vitest, React/Vite。

**Spec:** `docs/superpowers/specs/2026-10-15-wecom-head-freight-sync-design.md`

## Global Constraints

- 店铺匹配失败不影响其他行；有效行必须全部落库，原店铺名称保留，`store_id` 可为空。
- 同步必须走 API → BullMQ → Worker；前端不得直接调用企微。
- 原始 MCP 页响应和标准化在途行都落库；重复批次幂等。
- Bot 密钥只保存加密值，接口和日志不得返回明文。
- 不新增 WFS/头程页面；Sync Status 只增加一个综合按钮。
- 既有未提交改动不可回退；迁移按项目约定手动应用。

## Review Focus

- 未匹配店铺：行完整落库且不阻断后续页；测试放在 Task 4。
- MCP 游标重复或分页中断：不能死循环，已落库页可追踪；测试放在 Task 3。
- 空字段覆盖已有值：非空字段更新，空值不覆盖；测试放在 Task 4。
- 租户越权读取配置和在途记录：必须返回空/拒绝；测试放在 Task 2、Task 5。
- 重复同步：相同批次只更新不重复插入；测试放在 Task 4。

### Task 1: 数据库模型与迁移

**Files:**
- Create: `packages/db/src/schema/head-freight.ts`
- Create: `packages/db/migrations/0019_wecom_head_freight.sql`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/common.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `packages/db/src/schema/head-freight.test.ts`

**Interfaces:**
- Produces `wecomBotConfigs`, `headFreightRows` Drizzle tables and nullable tenant-scoped `rawPayloads.storeId` support for tenant-level MCP pages.

- [ ] **Step 1: Write failing schema tests** asserting the Bot config has one tenant key, the in-transit row stores raw store name plus nullable `storeId`, and the idempotency key is unique per tenant.
- [ ] **Step 2: Run `pnpm --filter @walmart-erp/db test -- --run packages/db/src/schema/head-freight.test.ts` and verify failure.**
- [ ] **Step 3: Add the Drizzle schema and hand-applied migration** with encrypted Bot key, document URL/table ID, source row identity, all script fields needed by the ERP, match status, raw payload reference, batch ID, timestamps and tenant/store indexes.
- [ ] **Step 4: Run the focused schema test and `pnpm --filter @walmart-erp/db exec tsc --noEmit`.**

### Task 2: Tenant Bot configuration API

**Files:**
- Create: `apps/api/src/routes/wecom.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/wecom.test.ts`

**Interfaces:**
- `GET /api/wecom/head-freight/config` returns `{ configured, documentUrl, tableId, updatedAt }` without the secret.
- `PUT /api/wecom/head-freight/config` accepts `{ botKey, documentUrl, tableId }`, encrypts the key and scopes the row to the authenticated tenant.

- [ ] **Step 1: Add failing tests** for unauthenticated 401, tenant isolation, masked GET response, and encrypted PUT persistence.
- [ ] **Step 2: Run the focused API tests and verify failure.**
- [ ] **Step 3: Implement route using the shared session scope and existing credential encryption helper; never log or serialize the Bot key.**
- [ ] **Step 4: Run the focused API tests and API typecheck.**

### Task 3: MCP client and row normalization

**Files:**
- Create: `apps/worker/src/integrations/wecom-mcp.ts`
- Create: `apps/worker/src/jobs/syncHeadFreight.ts`
- Test: `apps/worker/src/jobs/syncHeadFreight.test.ts`

**Interfaces:**
- `listSmartSheetRecords(config, page)` returns records and the next cursor from the MCP JSON-RPC response.
- `normalizeHeadFreightRecord(record, context)` returns a typed row retaining the original store name and source payload.

- [ ] **Step 1: Write failing tests** for MCP initialization, `limit=500` pagination, cursor termination, duplicate cursor guard, field aliases from the supplied Python script, and skipping empty placeholder rows.
- [ ] **Step 2: Run the focused Worker tests and verify failure.**
- [ ] **Step 3: Implement the JSON-RPC client with request timeout, cursor pagination, and bounded retry; normalize the script's field map without requiring a store match.**
- [ ] **Step 4: Run the focused Worker tests and Worker typecheck.**

### Task 4: Persist rows with optional store matching

**Files:**
- Modify: `apps/worker/src/jobs/syncHeadFreight.ts`
- Modify: `apps/worker/src/queue.ts`
- Test: `apps/worker/src/jobs/syncHeadFreight.test.ts`

**Interfaces:**
- `syncHeadFreightToDatabase(window, config)` returns `{ written, skipped, unmatchedStoreNames }`.

- [ ] **Step 1: Add failing persistence tests** for matched and unmatched stores, continuation after unmatched rows, non-empty-only updates, same-batch idempotency, and raw page persistence.
- [ ] **Step 2: Run the focused tests and verify failure.**
- [ ] **Step 3: Implement tenant-scoped name matching and nullable `storeId`; keep original store name and upsert every valid row, preserving existing values when incoming values are empty.**
- [ ] **Step 4: Add `head-freight` to `processSyncRequest`, load the tenant Bot config in the Worker, and return the summary.**
- [ ] **Step 5: Run Worker queue and persistence tests.**

### Task 5: Sync API and Sync Status button

**Files:**
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/web/src/dashboard.ts`
- Test: `apps/api/src/routes/sync.test.ts`
- Test: `apps/web/src/dashboard.test.ts`

**Interfaces:**
- `POST /api/sync` accepts `resource: "head-freight"` with the existing window shape.
- Sync Status renders one tenant-level button `同步头程在途`, not one button per store.

- [ ] **Step 1: Add failing API test** for the new resource whitelist and tenant-scoped enqueue payload.
- [ ] **Step 2: Add failing web test** asserting exactly one comprehensive head-freight button and no per-store duplicate.
- [ ] **Step 3: Extend the whitelist and render the button using the existing authenticated fetch shim.**
- [ ] **Step 4: Run API/Web focused tests and both typechecks.**

### Task 6: Result visibility and verification

**Files:**
- Modify: `apps/api/src/routes/sync-status.ts`
- Modify: `apps/web/src/dashboard.ts`
- Create: `docs/superpowers/acceptance/task-wecom-head-freight.md`

- [ ] **Step 1: Add failing read test** for tenant-scoped head-freight job/result summary and unmatched names.
- [ ] **Step 2: Implement the summary response and compact Sync Status display.**
- [ ] **Step 3: Run the full relevant test set, `git diff --check`, and package typechecks.**
- [ ] **Step 4: Apply migration manually in the configured MySQL instance, restart API/Worker/Web, and record the acceptance evidence without putting Bot secrets in the document.**
