CREATE TABLE IF NOT EXISTS price_snapshots (
  id varchar(64) NOT NULL PRIMARY KEY, tenant_id varchar(36) NOT NULL, store_id varchar(36) NOT NULL, sku varchar(191) NOT NULL,
  price decimal(19,4), currency varchar(3), promotion varchar(191), effective_at datetime(3), source_id varchar(191) NOT NULL,
  payload json, received_at datetime(3) NOT NULL,
  UNIQUE KEY price_snapshot_source_unique (store_id, sku, source_id), KEY price_snapshot_scope_idx (tenant_id, store_id, effective_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS advertising_facts (
  id varchar(64) NOT NULL PRIMARY KEY, tenant_id varchar(36) NOT NULL, store_id varchar(36) NOT NULL, fact_date date NOT NULL,
  campaign_id varchar(191), spend decimal(19,4), attributed_sales decimal(19,4), attributed_units decimal(19,4), impressions int, clicks int,
  currency varchar(3), complete int NOT NULL DEFAULT 0, source_id varchar(191) NOT NULL, payload json, received_at datetime(3) NOT NULL,
  UNIQUE KEY advertising_fact_source_unique (store_id, fact_date, campaign_id, source_id), KEY advertising_fact_scope_idx (tenant_id, store_id, fact_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id varchar(64) NOT NULL PRIMARY KEY, tenant_id varchar(36) NOT NULL, store_id varchar(36) NOT NULL, metric varchar(128) NOT NULL,
  value decimal(19,4), period_start date, period_end date, currency varchar(3), complete int NOT NULL DEFAULT 0, source_id varchar(191) NOT NULL,
  payload json, received_at datetime(3) NOT NULL,
  UNIQUE KEY performance_snapshot_source_unique (store_id, metric, period_start, period_end, source_id), KEY performance_snapshot_scope_idx (tenant_id, store_id, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
