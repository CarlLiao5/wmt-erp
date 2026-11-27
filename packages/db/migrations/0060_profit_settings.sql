CREATE TABLE IF NOT EXISTS profit_settings (
  tenant_id VARCHAR(36) PRIMARY KEY,
  exchange_rate DECIMAL(12,6) NOT NULL,
  sem_discount DECIMAL(7,4) NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
