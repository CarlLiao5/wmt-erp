ALTER TABLE `users`
  ADD COLUMN `display_name` varchar(160) NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_display_name_unique`
  ON `users` (`tenant_id`, `display_name`);
