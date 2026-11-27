# Bright Data legacy migration

The migration copies the legacy production tables `WBKC_item_names` and
`WBKC_product_inventory` into `brightdata_item_names` and
`brightdata_product_inventory`. They may be read from the same MySQL database
as the destination. The old source tables are never modified. Legacy
`run_history` is optional and is not fabricated when it did not exist.

## Backup and dry run

Confirm migrations `0026_brightdata_inventory` and
`0027_brightdata_item_product_name` are applied. Back up the destination tables
if they already contain data. Run a dry run first (the default mode). When
legacy and ERP tables share one database, `.env.db-connection` can supply
`MYSQL_URL` without putting credentials in command arguments:

```sh
node --env-file=.env.db-connection node_modules/.bin/vite-node scripts/migrate-brightdata-legacy.ts \
  --tenant-id default
```

The report includes source row counts, distinct Item IDs, destination counts,
failed scrape count, duplicate Item ID/time count, and the minimum and maximum
inventory query times. Legacy time strings without a timezone are interpreted
as China time (`Asia/Shanghai`). When an Item ID has duplicate names, the
newest `created_at` record supplies the destination label. Failed scrape rows
remain in `raw_payload` and map to `available_quantity = NULL`, not zero.
Invalid Item IDs, dates, or missing required fields stop before any writes.

## Apply

After reviewing the dry-run report, apply the migration:

```sh
node --env-file=.env.db-connection node_modules/.bin/vite-node scripts/migrate-brightdata-legacy.ts \
  --tenant-id default --apply
```

`--apply` writes the two destination tables in one transaction, in batches of
300 rows. Deterministic IDs and source-based idempotency keys make reruns
update migrated rows instead of duplicating them. Every inventory snapshot is
preserved, including duplicate Item ID/time pairs. Legacy rows are retained as
JSON in `raw_payload` for auditability. Optional source table names can be
provided with `--source-item-names TABLE`, `--source-product-inventory TABLE`,
and `--source-run-history TABLE`.

## Verification

Compare the apply report's destination counts and time range with a subsequent
dry run. Verify the database counts and time range:

```sql
SELECT COUNT(*) FROM brightdata_item_names WHERE tenant_id = 'default';
SELECT COUNT(*) FROM brightdata_product_inventory WHERE tenant_id = 'default';
SELECT COUNT(*) FROM brightdata_run_history WHERE tenant_id = 'default';
SELECT MIN(queried_at), MAX(queried_at)
  FROM brightdata_product_inventory WHERE tenant_id = 'default';
```

The script accepts `LEGACY_MYSQL_URL`, `MYSQL_URL`, and
`BRIGHTDATA_TENANT_ID` environment variables. If `LEGACY_MYSQL_URL` is
omitted, it reads source tables from `MYSQL_URL`. It defaults to dry-run unless
`--apply` is supplied.
