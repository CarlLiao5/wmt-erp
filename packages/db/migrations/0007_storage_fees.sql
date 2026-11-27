CREATE TABLE `storage_fees` (`id` varchar(64) NOT NULL, `tenant_id` varchar(36) NOT NULL, `store_id` varchar(36) NOT NULL, `month` varchar(7) NOT NULL, `fee_type` varchar(128) NOT NULL, `amount` decimal(19,4) NOT NULL, `currency` varchar(3) NOT NULL, `source_id` varchar(191) NOT NULL, `received_at` datetime(3) NOT NULL, PRIMARY KEY (`id`));
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_fee_source_unique` ON `storage_fees` (`store_id`,`month`,`fee_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `storage_fee_scope_idx` ON `storage_fees` (`tenant_id`,`store_id`,`month`);
