# WFS ITS Fee Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` for native execution or `superpowers:subagent-driven-development` for delegated execution. Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Walmart ITS fee estimates per existing WFS shipment and SKU, expose them in WFS details, and run full eligible backfill through a new Sync Status Work.

**Architecture:** Add tenant/store-scoped run, destination-option, and SKU-fee tables. A store-level `wfs-inbound-preview` Worker task reads the latest locally synchronized shipment/item snapshots, hashes normalized preview inputs, calls the fixed read-only preview endpoint for eligible changed shipments, and saves total and item-level fees. The existing WFS read model and Sync Status controls expose the result while preserving tenant/store/SKU visibility.

**Tech Stack:** TypeScript, Express, BullMQ, Drizzle ORM, MySQL, Vitest, existing browser-rendered Sync Status and WFS pages.

**Spec:** [`../specs/2026-11-12-wfs-its-fee-preview-design.md`](../specs/2026-11-12-wfs-its-fee-preview-design.md)

## Global Constraints

- Use only Doke `MYSQL_URL` for database reads/writes; never use the Docker database.
- Manually review and apply migration `0045_wfs_its_fee_previews.sql`; do not auto-run migrations.
- Call only `POST /v3/fulfillment/inbound-preview` for the preview operation; never create or update Walmart shipments.
- Keep every DB/API query scoped by tenant and store; apply existing SKU visibility before returning per-item charges.
- Exclude `CANCELLED` and `CANCELED`; require the exact address and SKU fields defined in the spec.
- Preserve last successful estimates after a failed request and mark them stale; missing amounts stay null, never zero.
- Persist all returned preview types/destinations separately; only `previewType=inbound` is labeled as ITS and alternatives are never summed.
- Process requests sequentially through the existing Walmart request limiter; do not add a recurring schedule.
- Preserve unrelated dirty worktree files and changes.

## Review Focus

- Repeated raw item snapshots with volatile display fields: select the latest row per store/shipment/SKU and send one SKU line; test later duplicate snapshots and cross-store shipment ID collisions.
- Cancelled status variants and missing/invalid address or item fields: skip with reason counts and issue no preview call; test each gate.
- Successful responses with multiple destinations, preview types, or missing fee fields: retain alternatives and nullable amounts without summing or fabricating zero; test response normalization.
- A changed request that fails after a prior success: retain the old fee with stale status and retry on the next run; test failure isolation and retry.
- A member who can view only some shipment SKUs: return visible item charges only and suppress totals containing hidden SKU amounts; test both full and partial visibility.

---

### Task 1: Add ITS estimate database schema

**Files:**
- Create: `packages/db/src/schema/wfs-fee-previews.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/wfs-fee-previews.test.ts`
- Modify: `packages/db/src/schema/schema.test.ts`
- Create: `packages/db/migrations/0045_wfs_its_fee_previews.sql`

**Interfaces:**
- Produces `wfsFeePreviewRuns`, `wfsFeePreviewOptions`, and `wfsFeePreviewItems` exports for Worker/API use.
- Run identity is `(tenant_id, store_id, shipment_id)`; option identity is `(tenant_id, store_id, shipment_id, preview_type, ship_node)`; item identity is option plus product identity.

- [x] **Step 1: Write failing schema tests** named `definesTenantStoreShipmentRunIdentity`, `indexesOptionsByShipmentAndDestination`, and `storesPerSkuFeesAsNullableDecimals`; assert scope/unique keys, last-attempt/last-success fields, decimal money types, and the tenant/store lookup indexes.
- [x] **Step 2: Run `./packages/db/node_modules/.bin/vitest run packages/db/src/schema/wfs-fee-previews.test.ts packages/db/src/schema/schema.test.ts`** and confirm new exports/constraints fail.
- [x] **Step 3: Implement the three Drizzle tables** with the names and uniqueness keys above; include last attempt and last success timestamps so stale estimates are distinguishable.
- [x] **Step 4: Add the matching manual SQL migration** with tenant/store lookup indexes and unique identities; export the schema and run the focused tests plus `pnpm --filter @walmart-erp/db typecheck`.

**Acceptance:** Drizzle schema and SQL migration describe the same three tables and indexes; money is stored as decimal, not floating point.

### Task 2: Implement preview normalization and the Worker backfill

**Files:**
- Create: `apps/worker/src/jobs/syncWfsFeePreview.ts`
- Create: `apps/worker/src/jobs/syncWfsFeePreview.test.ts`
- Modify: `packages/walmart-client/src/inbound-preview.test.ts` only if a missing endpoint/response contract assertion is needed.

**Interfaces:**
- `syncWfsFeePreviewToDatabase(input: { tenantId: string; storeId: string; batchId?: string }, connection: WalmartConnection): Promise<WfsFeePreviewSyncResult>`.
- `WfsFeePreviewSyncResult` reports `scanned`, `eligible`, `skipped`, `unchanged`, `previewed`, `noItsOption`, and `failed`, plus bounded skip-reason counts.
- Export pure helpers for candidate normalization, request hashing, and response normalization so focused tests do not need a live DB or Walmart API.

- [x] **Step 1: Write failing helper tests** named `skipsCancelledAndIncompleteShipments`, `keepsLatestItemSnapshotPerSku`, `hashesOnlyNormalizedPreviewInputs`, and `normalizesDestinationAndSkuFees`; assert cancelled/missing-field candidates make no request, same-SKU duplicates produce one line, changed submitted fields change the hash, and each option retains its own total plus item charges without summing alternatives.
- [x] **Step 2: Run `./apps/worker/node_modules/.bin/vitest run apps/worker/src/jobs/syncWfsFeePreview.test.ts`** and confirm the missing helper behavior fails.
- [x] **Step 3: Implement pure normalization helpers** using existing WFS field names (`returnAddress`, `gtin`, `itemQty`, `vendorPackQty`, `innerPackQty`, `expectedDeliveryDate`) and the Walmart response fields `totalNetTransferCharge` and `shipmentItems[].netTransferCharge`.
- [x] **Step 4: Add failing Worker tests** named `skipsUnchangedSuccessfulInputs`, `continuesAfterShipmentFailure`, `retriesFailedInputOnNextRun`, and `replacesOptionsOnlyAfterSuccessfulPreview`; assert no Walmart call for unchanged success, later shipments still run after one rejects, failed rows retain the previous successful estimate, and successful reruns transactionally replace old option/item rows.
- [x] **Step 5: Implement the Worker job** to select latest tenant/store WFS snapshots, exclude cancelled/incomplete shipments, read the prior run hash, skip unchanged successful/no-ITS requests, call `walmartInboundPreview`, persist each returned option and item transactionally, retain estimates on failure, and continue through the remaining shipments.
- [x] **Step 6: Run the focused Worker tests and `pnpm --filter @walmart-erp/worker typecheck`.**

**Acceptance:** First run previews every eligible shipment; future runs call Walmart only for new or changed inputs and retry failed inputs. Destination totals and per-SKU charges are persisted without logging credentials or full addresses.

### Task 3: Register the store-level Sync Status Work

**Files:**
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/routes/sync.test.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/queue.test.ts`
- Modify: `apps/web/src/dashboard.ts`
- Modify: `apps/web/src/dashboard.test.ts`

**Interfaces:**
- Resource key is `wfs-inbound-preview`; it is store-level and uses the normal 30-day sync window envelope, while its Worker scans all locally stored shipments.
- Worker dispatch calls `syncWfsFeePreviewToDatabase` with the store's existing Walmart connection loader.

- [x] **Step 1: Add failing API tests** named `enqueuesWfsPreviewForStoreAdmin` and `rejectsWfsPreviewForMember`; assert the server-derived tenant and requested store/resource are passed to enqueue, and members receive 403.
- [x] **Step 2: Add failing Worker dispatch test** `dispatchesWfsInboundPreviewWithStoreConnection`; assert the preview handler receives the same store request and connection and the inventory handler is not called.
- [x] **Step 3: Run the focused API/Worker tests** and verify the resource is rejected or unsupported before implementation.
- [x] **Step 4: Register the resource in API validation and Worker dispatch**, keeping it out of tenant-only resources and incremental policies.
- [x] **Step 5: Add an admin-only per-store “同步 WFS 费用预估” control in Sync Status**, a task label, and a result summary for scanned/previewed/unchanged/skipped/no-ITS/failed counts; test its resource key and result text.
- [x] **Step 6: Run focused API, Worker, and dashboard tests plus `pnpm --filter @walmart-erp/api typecheck` and `pnpm --filter @walmart-erp/worker typecheck`.**

**Acceptance:** The Work is visible and manually triggerable per store, appears in task history with useful counts, and does not create an automatic schedule.

### Task 4: Extend WFS API with saved estimate details and visibility

**Files:**
- Modify: `apps/api/src/routes/wfs.ts`
- Modify: `apps/api/src/routes/wfs.test.ts`

**Interfaces:**
- `mysqlWfsHistorySource()` attaches `feePreviews` to each shipment by tenant/store/shipment identity.
- Each option contains `previewType`, destination, nullable total/currency, stale state/time, and item lines containing SKU/GTIN/quantity/nullable unit transfer charge.

- [x] **Step 1: Add failing helper/API tests** named `joinsPreviewsByTenantStoreAndShipment`, `keepsSameShipmentIdsStoreScoped`, and `hidesTotalsWithInvisibleSkuLines`; assert admins receive all lines/totals while members receive only assigned SKU charges and a null total when any contributing line is hidden.
- [x] **Step 2: Run `./apps/api/node_modules/.bin/vitest run apps/api/src/routes/wfs.test.ts`** and confirm estimate visibility assertions fail.
- [x] **Step 3: Add scoped estimate reads to `mysqlWfsHistorySource()`** and attach only estimates matching its tenant/store/shipment.
- [x] **Step 4: Extend WFS visibility filtering** so member responses contain only permitted SKU fee rows and never expose totals that include hidden rows; preserve admin visibility.
- [x] **Step 5: Run focused WFS tests and `pnpm --filter @walmart-erp/api typecheck`.**

**Acceptance:** WFS responses expose estimates only within the authenticated tenant/store scope and do not leak unassigned SKU charges through lane totals.

### Task 5: Show totals and SKU charges in WFS shipment details

**Files:**
- Modify: `apps/web/src/pages/WfsPage.tsx`
- Create or modify: `apps/web/src/pages/WfsPage.test.ts`
- Modify: `apps/web/src/styles.css` only if the compact detail layout needs styling.

**Interfaces:**
- Extend the shipment API type with the `feePreviews` shape from Task 4.
- Display each `previewType=inbound` destination option as an ITS estimate; display other preview types separately.

- [x] **Step 1: Add failing render tests** named `rendersSeparateItsDestinationEstimates`, `rendersPerSkuTransferCharges`, and `labelsStaleAndMissingEstimates`; assert alternative totals remain separate, item values include quantity/currency, stale data is labeled, null values say “暂无数据”, and no-result/empty states do not invent amounts.
- [x] **Step 2: Run `./apps/api/node_modules/.bin/vitest run apps/web/src/pages/WfsPage.test.ts`** and confirm estimate sections are absent.
- [x] **Step 3: Render estimate options in expanded shipment details** without summing alternative destinations; format money with returned currency and preserve null as “暂无数据”.
- [x] **Step 4: Run the focused web tests, `pnpm --filter @walmart-erp/web typecheck`, and `git diff --check`.**

**Acceptance:** Users can inspect the estimated total per destination and per-SKU transfer charges in the matching shipment; no preview is presented as actual billed cost.

### Task 6: Apply migration and backfill Doke data

**Files:**
- No code files; use the reviewed migration and Sync Status Work.

- [ ] **Step 1: Confirm the Doke database is the target** by loading only `.env.db-connection`; do not print connection credentials or access Docker MySQL.
- [ ] **Step 2: Manually apply `0045_wfs_its_fee_previews.sql`** to Doke and verify the three tables and indexes exist.
- [ ] **Step 3: Restart the existing API and Worker processes with `MYSQL_URL` loaded from `.env.db-connection`** after checking screen names/PIDs; verify the old processes no longer hold their ports or continue against another database.
- [ ] **Step 4: Trigger the new Work once per production store** with locally synchronized WFS data; the Worker processes all eligible shipments sequentially and isolates individual failures.
- [ ] **Step 5: Verify database rows against Sync Status counts** for runs, destination options, and SKU charges; verify the previously tested shipment `4480592WFB` has the returned USD 175 preview and item-level charge.
- [ ] **Step 6: Open the WFS page and verify a shipment detail** shows its ITS destination option and per-SKU fee; report processed, skipped, unchanged, no-option, failed, option-row, and item-row counts.

**Acceptance:** The Doke database contains an idempotent initial backfill, Sync Status shows completed/partial outcomes, and the WFS page displays the saved estimates. Walmart calls remain limited to the approved inbound preview endpoint.
