-- Keep sync status and incremental plan pages responsive as history grows.
CREATE INDEX `sync_windows_plan_latest_idx`
  ON `sync_windows` (`tenant_id`, `plan_id`, `status`, `created_at` DESC, `id` DESC);

CREATE INDEX `sync_windows_plan_count_idx`
  ON `sync_windows` (`tenant_id`, `plan_id`, `status`);
