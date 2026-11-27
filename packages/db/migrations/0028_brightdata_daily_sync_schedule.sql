CREATE TABLE `brightdata_sync_schedules` (
  `tenant_id` varchar(36) NOT NULL,
  `enabled` int NOT NULL DEFAULT 0,
  `timezone` varchar(32) NOT NULL DEFAULT 'Asia/Shanghai',
  `next_run_at` datetime(3) DEFAULT NULL,
  `last_run_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`tenant_id`),
  KEY `brightdata_sync_schedules_due_idx` (`enabled`, `next_run_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
