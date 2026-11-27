ALTER TABLE price_snapshots
  ADD COLUMN target_price decimal(19,4) NULL AFTER price,
  ADD COLUMN price_type varchar(16) NOT NULL DEFAULT 'base' AFTER currency,
  ADD COLUMN incentive_type varchar(64) NULL AFTER promotion,
  ADD COLUMN incentive_status varchar(32) NULL AFTER incentive_type,
  ADD COLUMN incentive_id varchar(191) NULL AFTER incentive_status,
  ADD COLUMN start_date datetime(3) NULL AFTER incentive_id,
  ADD COLUMN end_date datetime(3) NULL AFTER start_date;
--> statement-breakpoint
ALTER TABLE price_snapshots DROP INDEX price_snapshot_source_unique;--> statement-breakpoint
ALTER TABLE price_snapshots ADD UNIQUE KEY price_snapshot_source_unique (store_id, sku, price_type, source_id);
