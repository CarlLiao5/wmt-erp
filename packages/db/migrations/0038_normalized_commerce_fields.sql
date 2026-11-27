ALTER TABLE `orders`
  ADD COLUMN `customer_order_id` varchar(64) NULL,
  ADD COLUMN `customer_email` varchar(255) NULL,
  ADD COLUMN `state` varchar(64) NULL,
  ADD COLUMN `postal_code` varchar(20) NULL,
  ADD COLUMN `city` varchar(128) NULL,
  ADD COLUMN `country` varchar(64) NULL,
  ADD COLUMN `estimated_delivery_at` datetime(3) NULL,
  ADD COLUMN `fulfillment_option` varchar(32) NULL,
  ADD COLUMN `ship_method` varchar(64) NULL,
  ADD COLUMN `is_wfs` tinyint NULL,
  ADD COLUMN `store_name` varchar(128) NULL,
  ADD COLUMN `source_api` varchar(32) NULL,
  MODIFY COLUMN `currency` varchar(8) NOT NULL;
--> statement-breakpoint
CREATE INDEX `orders_customer_order_idx` ON `orders` (`tenant_id`,`customer_order_id`);
--> statement-breakpoint
ALTER TABLE `order_lines`
  ADD COLUMN `line_number` varchar(32) NULL,
  ADD COLUMN `upc` varchar(32) NULL,
  ADD COLUMN `product_id` varchar(128) NULL,
  ADD COLUMN `product_name` varchar(512) NULL,
  ADD COLUMN `unit_price` decimal(19,4) NULL,
  ADD COLUMN `shipping_charge` decimal(19,4) NULL,
  ADD COLUMN `item_status` varchar(32) NULL,
  ADD COLUMN `created_at` datetime(3) NULL,
  ADD COLUMN `updated_at` datetime(3) NULL,
  MODIFY COLUMN `currency` varchar(8) NOT NULL;
--> statement-breakpoint
CREATE INDEX `order_lines_store_sku_idx` ON `order_lines` (`store_id`,`sku_id`);
--> statement-breakpoint
ALTER TABLE `return_records`
  ADD COLUMN `return_order_id` varchar(64) NULL,
  ADD COLUMN `customer_order_id` varchar(64) NULL,
  ADD COLUMN `return_order_item_id` varchar(64) NULL,
  ADD COLUMN `product_name` varchar(512) NULL,
  ADD COLUMN `quantity` int NULL,
  ADD COLUMN `currency` varchar(8) NULL,
  ADD COLUMN `reason_code` varchar(64) NULL,
  ADD COLUMN `return_initiated_at` datetime(3) NULL,
  ADD COLUMN `refund_issued_at` datetime(3) NULL,
  ADD COLUMN `is_wfs` tinyint NULL,
  ADD COLUMN `store_name` varchar(128) NULL,
  ADD COLUMN `return_method` varchar(64) NULL,
  ADD COLUMN `delivery_status` varchar(64) NULL,
  ADD COLUMN `channel_name` varchar(64) NULL,
  ADD COLUMN `refund_status` varchar(64) NULL,
  ADD COLUMN `created_at` datetime(3) NULL,
  ADD COLUMN `updated_at` datetime(3) NULL,
  MODIFY COLUMN `sku` varchar(191) NULL,
  MODIFY COLUMN `reason` varchar(512) NULL;
--> statement-breakpoint
CREATE TABLE `recon_transactions` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NOT NULL,
  `report_month` varchar(7) NOT NULL,
  `source_id` varchar(191) NOT NULL,
  `transaction_key` varchar(64) NOT NULL,
  `row_number` int NOT NULL,
  `transaction_id` varchar(191),
  `transaction_date` datetime(3),
  `description` varchar(255) NOT NULL,
  `transaction_type` varchar(128),
  `amount` decimal(19,4) NOT NULL,
  `currency` varchar(8) NOT NULL,
  `received_at` datetime(3) NOT NULL,
  CONSTRAINT `recon_transactions_id` PRIMARY KEY(`id`),
  CONSTRAINT `recon_transaction_source_key_unique` UNIQUE(`tenant_id`,`store_id`,`source_id`,`transaction_key`)
);
--> statement-breakpoint
CREATE INDEX `recon_transaction_scope_month_idx` ON `recon_transactions` (`tenant_id`,`store_id`,`report_month`);
--> statement-breakpoint
CREATE INDEX `recon_transaction_scope_date_idx` ON `recon_transactions` (`tenant_id`,`store_id`,`transaction_date`);
--> statement-breakpoint
CREATE INDEX `recon_transaction_description_idx` ON `recon_transactions` (`tenant_id`,`store_id`,`description`);
--> statement-breakpoint
CREATE INDEX `recon_transaction_type_idx` ON `recon_transactions` (`tenant_id`,`store_id`,`transaction_type`);
