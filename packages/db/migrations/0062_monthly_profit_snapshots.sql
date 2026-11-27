CREATE TABLE IF NOT EXISTS monthly_profit_snapshots (
  tenant_id VARCHAR(36) NOT NULL,
  profit_month CHAR(7) NOT NULL,
  next_run_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  calculated_at DATETIME(3) NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  exchange_rate DECIMAL(12,6) NULL,
  sem_discount DECIMAL(7,4) NULL,
  result JSON NULL,
  PRIMARY KEY (tenant_id, profit_month),
  KEY due_monthly_profit (next_run_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
