# ALLSKU2026 Owner-Based ERP SKU Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the latest ALLSKU2026 owner by store and SKU to grant ERP SKU visibility to the corresponding member, and display that owner in Items.

**Architecture:** Store a tenant-unique display name on each ERP user. During permission resolution, combine explicit `sku_assignments` with assignments derived from current ALLSKU rows, resolving source store/SKU/owner to ERP store/SKU/member records. Reconcile the current ALLSKU read model only after a complete upstream snapshot has been fetched and persisted, while retaining raw sync records.

**Tech Stack:** TypeScript, Express, MySQL 8, Drizzle ORM, Vite frontend.

**Spec:** `docs/superpowers/specs/2026-10-17-allsku-owner-permissions-design.md`

## Global Constraints

- Derive `tenantId` from the authenticated session; never trust a browser-supplied tenant or user ID.
- Keep admin visibility unchanged and union derived visibility with explicit `sku_assignments` rather than replacing manual permissions.
- Match owner names exactly; match stores exactly first, then allow one trailing `沃尔玛` to be removed only when the resulting ERP store match is unique.
- Match SKU only within its resolved store after trimming and case normalization.
- Ambiguous owners, stores, or duplicate source keys grant no derived access.
- Use latest successfully synced ALLSKU current rows for permissions; preserve raw sync payload records.
- Use an `ownerName` response field for display; do not put names in `ownerId`.
- Do not add dependencies or commit unrelated dirty worktree changes.

## Review Focus

- A member must not gain access through a same-SKU row in another store: validate store-scoped matching against current catalog rows.
- A source owner change must revoke the former derived access on the next request: reconcile removed source rows only after a complete successful snapshot.
- Existing explicit assignments must remain active when ALLSKU has no matching row: ensure the loader unions both sources.
- Duplicate or ambiguous source/store matches must fail closed: count conflicts and omit derived grants.
- Cross-tenant owner names and SKU rows must never match: all reads and unique display-name constraints include tenant scope.

---

### Task 1: Persist Member Display Names and Update Member Management

**Files:**
- Create: `packages/db/migrations/0025_user_display_name.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/common.ts`
- Modify: `apps/api/src/routes/members.ts`
- Modify: `apps/web/src/dashboard.ts`

**Interfaces:**
- `users.displayName` is nullable for existing users and unique by `(tenantId, displayName)` when non-null.
- `GET /api/members` returns `displayName`; `POST /api/members` accepts `displayName` and rejects a duplicate non-empty name within the tenant.

- [ ] Add migration and schema metadata for nullable `display_name` plus tenant-scoped unique index.
- [ ] Update member create/list API and Members form/list to read and save display names.
- [ ] Apply the migration to the development database and set exact display names for the three created accounts: `吴丽君 Nico`, `潘梓煊`, `张蕊 Miya`.
- [ ] Confirm the three accounts remain `member` role and their display names are unique in tenant `default`.

### Task 2: Reconcile the ALLSKU Current Snapshot

**Files:**
- Modify: `apps/worker/src/jobs/syncHeadFreight.ts`
- Modify: `packages/db/src/schema/smartsheet.ts` only if a query helper requires schema support.

**Interfaces:**
- `syncSmartSheetRecordsToRawPayloads()` continues to return received/written/skipped counts and preserves raw response storage.
- After listing every upstream page successfully and writing the new current rows, the function removes tenant current rows whose source IDs are absent from that complete snapshot.

- [ ] Persist the fully fetched record set before deleting stale current rows; do not reconcile when remote pagination or persistence fails.
- [ ] Preserve raw payload records independently from current-row reconciliation.
- [ ] Confirm that the current database still contains the 316 source records returned by the latest successful snapshot.

### Task 3: Build a Shared Store/SKU/Owner Resolver

**Files:**
- Create: `apps/api/src/routes/allskuOwnerMapping.ts`
- Modify: `apps/api/src/routes/commerce-visibility.ts`
- Modify: `apps/api/src/routes/items.ts`

**Interfaces:**
- `buildAllSkuOwnerMap(rows, stores, skus, members)` returns unambiguous entries keyed by `storeId + normalized SKU`, with `ownerName` and optional matching `ownerUserId`.
- Store resolution prefers one exact tenant store match; otherwise it removes one trailing `沃尔玛` and requires exactly one resulting tenant store.
- Owner resolution requires one exact tenant member `displayName` match; unresolved names preserve display-only ownership but grant no permission.

- [ ] Add the resolver using the actual SmartSheet payload shape (`values.SKU`, `values.店铺`, `values.当前负责人`).
- [ ] Make duplicate/conflicting source keys, ambiguous stores, and duplicate member identities produce no permission entry.
- [ ] Use the shared resolver from both the Items data source and permission loader to keep their mapping rules identical.

### Task 4: Apply Dynamic Owner Permissions and Items Display

**Files:**
- Modify: `apps/api/src/routes/commerce-visibility.ts`
- Modify: `apps/api/src/routes/items.ts`
- Modify: `apps/web/src/pages/ItemsPage.tsx`

**Interfaces:**
- `mysqlAssignmentLoader()` returns explicit assignments plus current ALLSKU-derived member/SKU assignments.
- `ItemRecord.ownerName` carries the matched ALLSKU current owner separately from `ownerId`.

- [ ] Union source-derived assignments with `sku_assignments`; retain existing store and SKU permission behavior.
- [ ] Ensure the Items visibility filter checks the existing composite `${storeId}:${sku}` SKU scope.
- [ ] Return and render `ownerName`, include it in Items search, and fall back to ERP `ownerId` or `未分配` when there is no unambiguous source match.
- [ ] Confirm current matched data resolves to 42 SKUs for 吴丽君 Nico, 1 for 张蕊 Miya, and none for 潘梓煊.

### Task 5: Runtime and User-Level Verification

**Files:**
- No additional files unless runtime findings require a scoped fix.

- [ ] Type-check the DB, API, Worker, and Web packages.
- [ ] Restart API, Worker, and Web so migration-aware API and reconciliation logic are active.
- [ ] Sign in with each created account and confirm only its currently matched SKU rows are visible; confirm admin still sees all items.
- [ ] Change one local fixture row in an isolated transaction or disposable database to verify owner transfer and stale-row revocation, then roll back the fixture change.
- [ ] Confirm the Items page displays current owner names and supports owner-name search.
- [ ] Run `git diff --check` and review only task-scoped modifications.
