ALTER TABLE monthly_profit_snapshots
  ADD COLUMN run_connection_id BIGINT UNSIGNED NULL,
  ADD COLUMN failed_at DATETIME(3) NULL;
