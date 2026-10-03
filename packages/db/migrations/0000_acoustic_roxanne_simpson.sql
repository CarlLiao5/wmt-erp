CREATE TABLE `raw_payloads` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`resource` varchar(80) NOT NULL,
	`external_id` varchar(191) NOT NULL,
	`payload` json NOT NULL,
	`http_status` int NOT NULL,
	`correlation_id` varchar(64) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	CONSTRAINT `raw_payloads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`marketplace` varchar(32) NOT NULL DEFAULT 'walmart',
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` varchar(32) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_credentials` (
	`store_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`encrypted_secret` varchar(1024) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `store_credentials_store_id` PRIMARY KEY(`store_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sku_assignments` (
	`tenant_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`sku_id` varchar(36) NOT NULL,
	`valid_from` datetime(3) NOT NULL,
	`valid_until` datetime(3),
	CONSTRAINT `sku_assignments_tenant_id_user_id_sku_id_pk` PRIMARY KEY(`tenant_id`,`user_id`,`sku_id`)
);
--> statement-breakpoint
CREATE TABLE `store_assignments` (
	`tenant_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`valid_from` datetime(3) NOT NULL,
	`valid_until` datetime(3),
	CONSTRAINT `store_assignments_tenant_id_user_id_store_id_pk` PRIMARY KEY(`tenant_id`,`user_id`,`store_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`resource` varchar(80) NOT NULL,
	`cursor` varchar(191),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `sync_cursor_unique` UNIQUE(`store_id`,`resource`)
);
--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`resource` varchar(80) NOT NULL,
	`idempotency_key` varchar(191) NOT NULL,
	`status` varchar(32) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`available_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `sync_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_job_idempotency_unique` UNIQUE(`store_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `skus` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`external_id` varchar(191) NOT NULL,
	`item_id` varchar(191),
	`title` varchar(500),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `skus_id` PRIMARY KEY(`id`),
	CONSTRAINT `skus_store_external_unique` UNIQUE(`store_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`order_id` varchar(36) NOT NULL,
	`sku_id` varchar(36) NOT NULL,
	`quantity` decimal(19,4) NOT NULL,
	`line_amount` decimal(19,4) NOT NULL,
	`currency` varchar(3) NOT NULL,
	CONSTRAINT `order_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`external_id` varchar(191) NOT NULL,
	`status` varchar(40) NOT NULL,
	`ordered_at` datetime(3) NOT NULL,
	`total_amount` decimal(19,4) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_store_external_unique` UNIQUE(`store_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`sku_id` varchar(36) NOT NULL,
	`node_id` varchar(191) NOT NULL,
	`quantity` decimal(19,4) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`idempotency_key` varchar(191) NOT NULL,
	CONSTRAINT `inventory_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_facts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`store_id` varchar(36) NOT NULL,
	`fact_date` date NOT NULL,
	`metric` varchar(80) NOT NULL,
	`value` decimal(19,4) NOT NULL,
	`currency` varchar(3),
	CONSTRAINT `daily_facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_fact_unique` UNIQUE(`store_id`,`fact_date`,`metric`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`action` varchar(100) NOT NULL,
	`payload` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `raw_payload_scope_idx` ON `raw_payloads` (`tenant_id`,`store_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `stores_tenant_idx` ON `stores` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `store_assignment_valid_idx` ON `store_assignments` (`valid_from`,`valid_until`);--> statement-breakpoint
CREATE INDEX `sync_jobs_due_idx` ON `sync_jobs` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `skus_scope_idx` ON `skus` (`tenant_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `order_lines_scope_idx` ON `order_lines` (`tenant_id`,`store_id`,`sku_id`);--> statement-breakpoint
CREATE INDEX `orders_scope_time_idx` ON `orders` (`tenant_id`,`store_id`,`ordered_at`);--> statement-breakpoint
CREATE INDEX `inventory_scope_time_idx` ON `inventory_snapshots` (`tenant_id`,`store_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `daily_fact_scope_idx` ON `daily_facts` (`tenant_id`,`store_id`,`fact_date`);--> statement-breakpoint
CREATE INDEX `audit_scope_time_idx` ON `audit_events` (`tenant_id`,`created_at`);