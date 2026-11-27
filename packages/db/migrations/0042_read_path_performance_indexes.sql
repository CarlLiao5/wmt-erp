CREATE INDEX `raw_payload_resource_store_time_idx` ON `raw_payloads` (`tenant_id`, `resource`, `store_id`, `received_at`);
--> statement-breakpoint
CREATE INDEX `wfs_inventory_logs_shipment_idx` ON `wfs_inventory_logs` (`tenant_id`, `shipment_id`, `store_id`);
--> statement-breakpoint
CREATE INDEX `wfs_inventory_logs_scope_shipment_sku_idx` ON `wfs_inventory_logs` (`tenant_id`, `store_id`, `shipment_id`, `sku`);
--> statement-breakpoint
CREATE INDEX `inventory_snapshot_latest_idx` ON `inventory_snapshots` (`tenant_id`, `store_id`, `sku_id`, `node_id`, `occurred_at` DESC, `id` ASC);
--> statement-breakpoint
CREATE INDEX `orders_tenant_ordered_id_idx` ON `orders` (`tenant_id`, `ordered_at` DESC, `id` ASC);
--> statement-breakpoint
CREATE INDEX `weather_snapshots_state_latest_idx` ON `weather_snapshots` (`state_code`, `value`, `observed_at` DESC, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX `sync_jobs_tenant_created_idx` ON `sync_jobs` (`tenant_id`, `created_at` DESC, `id` DESC);
--> statement-breakpoint
CREATE INDEX `sync_jobs_tenant_store_created_idx` ON `sync_jobs` (`tenant_id`, `store_id`, `created_at` DESC, `id` DESC);
