CREATE TABLE `return_records` (
  `id` varchar(191) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NOT NULL,
  `order_id` varchar(191) NOT NULL,
  `order_number` varchar(191),
  `item_id` varchar(191),
  `sku` varchar(191) NOT NULL,
  `status` varchar(80) NOT NULL,
  `amount` decimal(19,4) NOT NULL,
  `reason` varchar(255),
  `returned_at` varchar(40) NOT NULL,
  CONSTRAINT `return_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `return_records_scope_date_idx` ON `return_records` (`tenant_id`,`store_id`,`returned_at`);
--> statement-breakpoint
CREATE INDEX `return_records_tenant_date_idx` ON `return_records` (`tenant_id`,`returned_at`);
--> statement-breakpoint
CREATE INDEX `return_records_order_idx` ON `return_records` (`tenant_id`,`order_id`);
--> statement-breakpoint
CREATE INDEX `return_records_sku_idx` ON `return_records` (`tenant_id`,`store_id`,`sku`);
