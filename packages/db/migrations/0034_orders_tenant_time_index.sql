CREATE INDEX `orders_tenant_time_idx` ON `orders` (`tenant_id`,`ordered_at`);
--> statement-breakpoint
CREATE INDEX `order_lines_order_scope_idx` ON `order_lines` (`tenant_id`,`order_id`);
