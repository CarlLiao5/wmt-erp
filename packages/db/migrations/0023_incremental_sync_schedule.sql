ALTER TABLE `sync_plans` ADD COLUMN `interval_minutes` int NOT NULL DEFAULT 0;
ALTER TABLE `sync_plans` ADD COLUMN `overlap_days` int NOT NULL DEFAULT 0;
ALTER TABLE `sync_plans` ADD COLUMN `next_run_at` datetime(3) NULL;
ALTER TABLE `sync_plans` ADD COLUMN `enabled` tinyint NOT NULL DEFAULT 0;
ALTER TABLE `sync_plans` ADD KEY `sync_plan_schedule_idx` (`enabled`, `mode`, `next_run_at`);
