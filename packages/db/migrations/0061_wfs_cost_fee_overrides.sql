CREATE TABLE IF NOT EXISTS wfs_cost_fee_overrides (
  tenant_id VARCHAR(36) NOT NULL,
  sku VARCHAR(191) NOT NULL,
  last_mile DECIMAL(24,12) NULL,
  commission_percent DECIMAL(9,6) NULL,
  PRIMARY KEY (tenant_id, sku)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
