ALTER TABLE `raw_payloads` MODIFY COLUMN `store_id` varchar(36) NULL;
ALTER TABLE `sync_jobs` ADD COLUMN `result_payload` json NULL;

CREATE TABLE `wecom_bot_configs` (
  `tenant_id` varchar(36) NOT NULL,
  `encrypted_bot_key` varchar(1024) NOT NULL,
  `document_url` varchar(1024) NOT NULL,
  `table_id` varchar(191) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `head_freight_rows` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NULL,
  `source_store_name` varchar(191) NULL,
  `contract_number` varchar(191) NULL,
  `purchase_batch_number` varchar(191) NULL,
  `sku` varchar(191) NULL,
  `product_name` varchar(512) NULL,
  `quantity` varchar(64) NULL,
  `carton_count` varchar(64) NULL,
  `wfs_shipment_number` varchar(191) NULL,
  `freight_forwarder_inbound_number` varchar(191) NULL,
  `tracking_number` varchar(191) NULL,
  `shipped_at` varchar(64) NULL,
  `etd` varchar(64) NULL,
  `eta` varchar(64) NULL,
  `current_status` varchar(128) NULL,
  `signed_status` varchar(128) NULL,
  `billable_weight` varchar(64) NULL,
  `total_freight` varchar(64) NULL,
  `logistics_provider` varchar(191) NULL,
  `warehouse` varchar(191) NULL,
  `payment_status` varchar(128) NULL,
  `shipping_status` varchar(128) NULL,
  `shipping_method` varchar(128) NULL,
  `channel` varchar(128) NULL,
  `match_status` varchar(32) NOT NULL DEFAULT 'unmatched',
  `source_row_id` varchar(191) NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `batch_id` varchar(64) NOT NULL,
  `raw_payload_id` varchar(191) NULL,
  `payload` json NULL,
  `received_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `head_freight_idempotency_unique` (`tenant_id`, `idempotency_key`),
  KEY `head_freight_scope_idx` (`tenant_id`, `store_id`, `updated_at`),
  KEY `head_freight_source_idx` (`tenant_id`, `source_row_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
