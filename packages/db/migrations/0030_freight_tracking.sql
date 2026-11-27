CREATE TABLE `freight_tracking_routes` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `freight_forwarder_inbound_number` varchar(191) NOT NULL,
  `brand` varchar(32) NOT NULL,
  `current_status` varchar(32) NOT NULL,
  `current_status_text` varchar(200) NOT NULL,
  `last_event_at` datetime(3) NULL,
  `last_fetched_at` datetime(3) NOT NULL,
  `last_successful_batch_id` varchar(64) NOT NULL,
  `raw_payload_id` bigint unsigned NOT NULL,
  `source_head_freight_row_ids` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `freight_tracking_tenant_inbound_unique` (`tenant_id`, `freight_forwarder_inbound_number`),
  KEY `freight_tracking_status_idx` (`tenant_id`, `current_status`, `last_event_at`),
  KEY `freight_tracking_batch_idx` (`tenant_id`, `last_successful_batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `freight_tracking_events` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `route_id` varchar(64) NOT NULL,
  `route_order` int NOT NULL,
  `event_time_text` varchar(191) NOT NULL,
  `event_at` datetime(3) NULL,
  `info` text NOT NULL,
  `event_code` varchar(64) NOT NULL,
  `raw` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `freight_tracking_event_route_order_unique` (`route_id`, `route_order`),
  KEY `freight_tracking_events_scope_idx` (`tenant_id`, `route_id`, `event_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
