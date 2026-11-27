# WFS shipment standardization

Approved scope: retain raw responses; add current shipment and shipment SKU tables in Doke; backfill historical JSON; route full and incremental shipment ingestion through the same repository; switch shipment page source without changing permissions or actual receipt/shipped calculations.

1. Add normalizers/repository and SQL tables with Chinese comments. Identity is tenant/store/shipment, item identity uses SKU then GTIN/itemId. Timestamps guard against stale backfills; missing partial values must not clear known fields.
2. Test full-history and incremental ingestion with fake paginated adapters. Full mode enumerates all historical shipments and item pages; incremental uses a 5-day creation window and precise lookup of stored nonterminal shipments. Do not derive discovery from head freight. Persist raw and business rows together.
3. Switch WFS shipment source and detail source to business tables; retain response payload for extra fields, override core fields from typed columns; reconciliations stay unchanged. Existing tenant/member filtering stays in API.
4. Apply migration, backfill ordered raw rows in batches, verify counts/duplicates/scopes and latest-source parity. Run DB/API/Worker tests and typechecks; restart API/Worker with health verification.

No new external write endpoints. No deletes of historical raw rows or inventory records. Full synchronization is supported, not automatically triggered for every store as part of migration.
