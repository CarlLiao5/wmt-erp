CREATE TABLE `sync_plans` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NOT NULL,
  `resource` varchar(80) NOT NULL,
  `mode` varchar(16) NOT NULL,
  `requested_from` datetime(3) NULL,
  `requested_to` datetime(3) NULL,
  `status` varchar(32) NOT NULL DEFAULT 'planned',
  `boundary_reason` varchar(255) NULL,
  `coverage_from` datetime(3) NULL,
  `coverage_to` datetime(3) NULL,
  `source` varchar(32) NOT NULL DEFAULT 'walmart_api',
  `result_payload` json NULL,
  `last_error` varchar(1024) NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `sync_plan_scope_unique` UNIQUE (`tenant_id`, `store_id`, `resource`, `mode`),
  KEY `sync_plan_status_idx` (`tenant_id`, `store_id`, `status`)
);

CREATE TABLE `sync_windows` (
  `id` varchar(36) NOT NULL,
  `plan_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NOT NULL,
  `resource` varchar(80) NOT NULL,
  `batch_id` varchar(64) NOT NULL,
  `window_from` datetime(3) NOT NULL,
  `window_to` datetime(3) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'planned',
  `request_params` json NULL,
  `cursor` varchar(191) NULL,
  `page_count` int NOT NULL DEFAULT 0,
  `record_count` int NOT NULL DEFAULT 0,
  `attempts` int NOT NULL DEFAULT 0,
  `coverage_from` datetime(3) NULL,
  `coverage_to` datetime(3) NULL,
  `source` varchar(32) NOT NULL DEFAULT 'walmart_api',
  `boundary_reason` varchar(255) NULL,
  `last_error` varchar(1024) NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `sync_window_scope_unique` UNIQUE (`tenant_id`, `store_id`, `resource`, `window_from`, `window_to`, `batch_id`),
  KEY `sync_window_plan_idx` (`plan_id`, `status`),
  KEY `sync_window_scope_idx` (`tenant_id`, `store_id`, `resource`, `window_from`)
);

ALTER TABLE `sync_jobs` ADD COLUMN `sync_window_id` varchar(36) NULL;
ALTER TABLE `sync_jobs` ADD KEY `sync_jobs_window_idx` (`sync_window_id`);
