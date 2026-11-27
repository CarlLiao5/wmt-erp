CREATE TABLE `smartsheet_allsku_rows` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `source_row_id` varchar(191) NOT NULL,
  `payload` json NOT NULL,
  `batch_id` varchar(64) NOT NULL,
  `synced_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `smartsheet_allsku_source_unique` (`tenant_id`, `source_row_id`),
  KEY `smartsheet_allsku_tenant_updated_idx` (`tenant_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
