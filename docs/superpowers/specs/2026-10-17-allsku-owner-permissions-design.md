# ALLSKU2026 Owner-Based ERP SKU Permissions

## Goal

Use the current owner in the synced ALLSKU2026 table as the source for ERP member SKU visibility, matching by store and SKU, and show the linked owner in Items.

## Approved Behavior

- Each ERP member has a tenant-scoped display name that exactly matches an ALLSKU2026 `当前负责人` value.
- Store matching prefers an exact ERP store name. If there is no exact match, the source name may have one trailing `沃尔玛` removed and then be matched exactly to an ERP store name.
- SKU matching is scoped to the matched store and uses the trimmed, case-insensitive SKU identifier.
- A matching ALLSKU2026 row grants its matched member visibility to that ERP SKU. Admin visibility remains unchanged.
- ALLSKU-derived visibility is calculated from the latest synced ALLSKU2026 rows during permission resolution. When a row changes owner or disappears from the source table, the old derived permission stops applying on the next request. Existing explicit `sku_assignments` remain independent and continue to apply.
- Rows with no ERP store, SKU, owner name, or matching member do not grant access.
- Items displays the linked source owner name for matched store/SKU rows. Search includes that name. Unmatched items continue to display an existing ERP owner if one is available, otherwise `未分配`.
- Accounts created for this integration are ordinary `member` accounts. Their passwords are generated separately and must not be stored in this design document.

## Current Data Baseline

- ALLSKU2026 contains 316 rows; 306 have a SKU and 315 have a current owner.
- 43 rows match an ERP item by store and SKU with the approved store matching rule. No matched SKU has conflicting owners.
- The 43 matches currently belong to 吴丽君 Nico (42) and 张蕊 Miya (1). 潘梓煊 currently has no matching ERP item.
- The three requested member accounts have been created in tenant `default`; the current schema does not yet store their display names.

## Data and API Changes

- Add nullable `display_name` to tenant members and enforce uniqueness for non-null names within a tenant.
- Member creation and member listing accept/return display names.
- Extend the assignment loader to derive active SKU assignments from ALLSKU rows by joining the source owner name to the member display name and the source store/SKU to the ERP catalog.
- Extend Items records with a separate `ownerName` field; do not overload `ownerId` with a display name.
- No generated assignment rows are written to `sku_assignments`; that table remains the explicit/manual assignment source.

## Security and Failure Rules

- Every lookup is tenant-scoped. Never accept `tenantId`, `userId`, or assignment scope from the browser as authority.
- A source owner string matching multiple member display names is prevented by the tenant-scoped unique constraint.
- Ambiguous store aliases, unknown members, and unmatched SKUs fail closed and grant no derived visibility.
- Admin users retain their current unrestricted tenant visibility.

## Acceptance Criteria

- The three created members can be matched to their exact ALLSKU2026 owner names.
- The 42 matched SKUs for 吴丽君 Nico and the 1 matched SKU for 张蕊 Miya are visible to those members; 潘梓煊 receives no SKU visibility from current data.
- Changing an ALLSKU owner changes derived visibility on the next request without leaving the old derived grant active.
- An explicit `sku_assignments` grant remains active regardless of ALLSKU owner changes.
- Cross-tenant names, cross-store duplicate SKUs, and unmapped owners never grant access.
- Items shows the source owner for matched products and supports filtering by that owner.
