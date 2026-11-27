CREATE TABLE sem_item_advertising_facts (
  id varchar(64) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  store_id varchar(36) NOT NULL,
  campaign_id varchar(191) NOT NULL,
  sku varchar(191) NOT NULL,
  item_id varchar(191),
  fact_date date NOT NULL,
  spend decimal(19,4),
  attributed_sales decimal(19,4),
  impressions int,
  clicks int,
  attributed_units int,
  currency varchar(3) DEFAULT 'USD',
  complete int NOT NULL DEFAULT 0,
  source_id varchar(191) NOT NULL,
  payload json,
  received_at datetime(3) NOT NULL,
  PRIMARY KEY (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sem_item_advertising_fact_unique ON sem_item_advertising_facts (store_id,campaign_id,sku,fact_date,source_id);
--> statement-breakpoint
CREATE INDEX sem_item_advertising_scope_idx ON sem_item_advertising_facts (tenant_id,store_id,fact_date,sku);
