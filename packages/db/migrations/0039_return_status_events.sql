ALTER TABLE `orders` MODIFY COLUMN `ordered_at` datetime(3) NULL;
--> statement-breakpoint
CREATE TABLE `return_status_events` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `store_id` varchar(36) NOT NULL,
  `return_id` varchar(191) NOT NULL,
  `source_identity` varchar(191) NOT NULL,
  `status` varchar(80) NOT NULL,
  `refund_amount` decimal(19,4),
  `returned_at` datetime(3),
  `raw_response_id` varchar(191),
  `recorded_at` datetime(3) NOT NULL,
  CONSTRAINT `return_status_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `return_status_event_source_unique` UNIQUE(`store_id`,`source_identity`)
);
--> statement-breakpoint
CREATE INDEX `return_status_event_scope_idx` ON `return_status_events` (`tenant_id`,`store_id`,`return_id`,`returned_at`);
--> statement-breakpoint
CREATE INDEX `return_status_event_tenant_date_idx` ON `return_status_events` (`tenant_id`,`returned_at`);
