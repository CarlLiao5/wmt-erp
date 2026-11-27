CREATE TABLE `lingxing_configs` (
  `tenant_id` varchar(36) NOT NULL,
  `encrypted_mcp_key` varchar(1024) NOT NULL,
  `advertiser_ids` varchar(2048) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
