CREATE TABLE IF NOT EXISTS wfs_inventory_recon_runs (
 id CHAR(64) NOT NULL COMMENT '确定性运行ID：租户店铺批次月份',
 tenant_id VARCHAR(36) NOT NULL, store_id VARCHAR(36) NOT NULL,
 report_month CHAR(7) NOT NULL COMMENT 'Walmart报告自然月',
 batch_key VARCHAR(191) NOT NULL,
 request_id VARCHAR(100) NULL COMMENT '异步报告编号，重试复用',
 status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending/requested/ready/completed/failed',
 row_count INT NOT NULL DEFAULT 0, difference_count INT NOT NULL DEFAULT 0 COMMENT '库存不平行数',
 starting_quantity BIGINT NOT NULL DEFAULT 0, final_quantity BIGINT NOT NULL DEFAULT 0,
 error_message VARCHAR(500) NULL, created_at DATETIME(3) NOT NULL, completed_at DATETIME(3) NULL,
 PRIMARY KEY(id), KEY inventory_recon_scope_month (tenant_id,store_id,report_month,completed_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='WFS月度库存对账报告运行元数据';
CREATE TABLE IF NOT EXISTS wfs_inventory_recon_rows (
 id CHAR(64) NOT NULL, run_id CHAR(64) NOT NULL, tenant_id VARCHAR(36) NOT NULL, store_id VARCHAR(36) NOT NULL,
 report_month CHAR(7) NOT NULL, sku VARCHAR(191) NOT NULL, gtin VARCHAR(64) NULL, item_id VARCHAR(64) NULL,
 item_name TEXT NULL, fulfillment_center VARCHAR(191) NOT NULL,
 starting_quantity BIGINT NOT NULL COMMENT '期初库存',
 received BIGINT NOT NULL, sold BIGINT NOT NULL COMMENT '带符号销售变动', lost BIGINT NOT NULL, found BIGINT NOT NULL,
 undelivered BIGINT NOT NULL, transferred BIGINT NOT NULL, returned_to_seller BIGINT NOT NULL, removed BIGINT NOT NULL,
 final_quantity BIGINT NOT NULL COMMENT '期末库存', difference BIGINT NOT NULL COMMENT '期末-期初-带符号变动',
 PRIMARY KEY(id), UNIQUE KEY inventory_recon_run_sku_fc (run_id,sku,fulfillment_center),
 KEY inventory_recon_product_month (tenant_id,store_id,report_month,sku)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='WFS库存对账SKU仓库月度快照，保留报告版本';
