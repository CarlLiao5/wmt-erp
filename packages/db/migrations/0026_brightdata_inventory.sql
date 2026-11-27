CREATE TABLE `brightdata_item_names` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NULL,
  `item_id` varchar(191) NOT NULL,
  `source_row_id` varchar(191) NULL,
  `raw_payload` json NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brightdata_item_names_tenant_item_unique` (`tenant_id`, `item_id`),
  KEY `brightdata_item_names_scope_idx` (`tenant_id`, `store_id`),
  KEY `brightdata_item_names_source_idx` (`tenant_id`, `source_row_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `brightdata_product_inventory` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NULL,
  `source_item_id` varchar(36) NULL,
  `item_id` varchar(191) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `product_name` varchar(1000) NULL,
  `available_quantity` int NULL,
  `queried_at` datetime(3) NOT NULL,
  `price` decimal(19,4) NULL,
  `description` text NULL,
  `rating` decimal(5,2) NULL,
  `review_count` int NULL,
  `raw_payload` json NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brightdata_product_inventory_idempotency_unique` (`tenant_id`, `idempotency_key`),
  KEY `brightdata_product_inventory_scope_time_idx` (`tenant_id`, `item_id`, `queried_at`),
  KEY `brightdata_product_inventory_snapshot_idx` (`tenant_id`, `queried_at`),
  KEY `brightdata_product_inventory_run_idx` (`tenant_id`, `run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `brightdata_run_history` (
  `run_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `started_at` datetime(3) NOT NULL,
  `ended_at` datetime(3) NULL,
  `total_items` int NOT NULL DEFAULT 0,
  `success_count` int NOT NULL DEFAULT 0,
  `fail_count` int NOT NULL DEFAULT 0,
  `status` varchar(32) NOT NULL,
  `error_message` text NULL,
  PRIMARY KEY (`run_id`),
  KEY `brightdata_run_history_tenant_started_idx` (`tenant_id`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
