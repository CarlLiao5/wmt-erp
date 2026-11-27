-- Task 11 governance: keep a rollback copy before normalizing analytics data.
CREATE TABLE IF NOT EXISTS daily_facts_backup_20261008 LIKE daily_facts;
--> statement-breakpoint
INSERT INTO daily_facts_backup_20261008 (id, tenant_id, store_id, fact_date, metric, value, currency)
SELECT id, tenant_id, store_id, fact_date, metric, value, currency FROM daily_facts
ON DUPLICATE KEY UPDATE value = VALUES(value), currency = VALUES(currency);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS daily_facts_governance (
  id varchar(36) NOT NULL,
  action varchar(32) NOT NULL,
  source_table varchar(64) NOT NULL,
  backup_table varchar(64) NOT NULL,
  rows_before int NOT NULL,
  duplicate_groups int NOT NULL,
  rows_after int NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (id)
);
--> statement-breakpoint

ALTER TABLE target_import_rows ADD COLUMN store_id varchar(36) NULL;--> statement-breakpoint
ALTER TABLE sales_targets ADD COLUMN store_id varchar(36) NULL;--> statement-breakpoint
ALTER TABLE sales_targets DROP INDEX sales_targets_tenant_month_unique;--> statement-breakpoint
CREATE UNIQUE INDEX sales_targets_tenant_month_store_unique ON sales_targets (tenant_id, month, store_id);--> statement-breakpoint
CREATE INDEX sales_targets_scope_store_idx ON sales_targets (tenant_id, month, store_id);
