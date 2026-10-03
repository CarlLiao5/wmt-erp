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
- [ ] Task 7
- [ ] Task 8
- [ ] Task 9
- [ ] Task 10
- [ ] Task 11
- [ ] Task 12
- [ ] Task 13
