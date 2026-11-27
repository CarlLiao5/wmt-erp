CREATE TABLE IF NOT EXISTS wfs_shipments (
 id CHAR(64) PRIMARY KEY COMMENT '租户店铺货件身份哈希',
 tenant_id VARCHAR(36) NOT NULL COMMENT '所属租户', store_id VARCHAR(36) NOT NULL COMMENT '所属店铺',
 shipment_id VARCHAR(191) NOT NULL COMMENT 'WFS货件号', inbound_order_id VARCHAR(191) NULL COMMENT '入库订单号',
 status VARCHAR(100) NULL COMMENT 'Walmart货件状态', created_date DATETIME(3) NULL COMMENT '货件创建时间',
 expected_delivery_date DATETIME(3) NULL COMMENT '预计送达时间', actual_delivery_date DATETIME(3) NULL COMMENT 'API实际送达时间',
 updated_expected_delivery_date DATETIME(3) NULL COMMENT '更新后的预计送达时间',
 shipment_units DECIMAL(18,4) NULL COMMENT 'API货件计划总数量', received_units DECIMAL(18,4) NULL COMMENT 'API货件收货总数量',
 return_address JSON NULL COMMENT '退回地址', destination_node VARCHAR(191) NULL COMMENT '目的仓标识或名称',
 tracking_no TEXT NULL COMMENT '追踪号码', carrier_name VARCHAR(255) NULL COMMENT '承运商',
 ship_to_address JSON NULL COMMENT '目的仓库地址及仓库标识',
 payload JSON NOT NULL COMMENT '最新货件响应及扩展字段', source_raw_id VARCHAR(191) NULL COMMENT '原始响应归档ID',
 first_seen_at DATETIME(3) NOT NULL COMMENT '首次同步时间', last_seen_at DATETIME(3) NOT NULL COMMENT '最新同步时间',
 UNIQUE KEY wfs_shipment_identity (tenant_id,store_id,shipment_id),
 KEY wfs_shipment_created (tenant_id,store_id,created_date), KEY wfs_shipment_status (tenant_id,store_id,status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='Walmart WFS标准化货件主表，按店铺货件保留最新状态';
CREATE TABLE IF NOT EXISTS wfs_shipment_items (
 id CHAR(64) PRIMARY KEY COMMENT '货件商品身份哈希',
 tenant_id VARCHAR(36) NOT NULL COMMENT '所属租户', store_id VARCHAR(36) NOT NULL COMMENT '所属店铺',
 shipment_id VARCHAR(191) NOT NULL COMMENT '所属WFS货件号', item_identity VARCHAR(255) NOT NULL COMMENT '货件内SKU或商品唯一标识',
 sku VARCHAR(191) NULL COMMENT '卖家SKU', item_id VARCHAR(191) NULL COMMENT 'Walmart商品Item ID', gtin VARCHAR(191) NULL COMMENT '商品GTIN',
 product_name TEXT NULL COMMENT '商品名称', planned_quantity DECIMAL(18,4) NULL COMMENT 'API计划发货数量', received_quantity DECIMAL(18,4) NULL COMMENT 'API报告收货数量，区别于库存日志实际收货',
 damaged_quantity DECIMAL(18,4) NULL COMMENT 'API损坏数量', inner_pack_quantity DECIMAL(18,4) NULL COMMENT '内箱数量', vendor_pack_quantity DECIMAL(18,4) NULL COMMENT '供应商箱数', ship_node_name VARCHAR(191) NULL COMMENT '目的仓名称',
 payload JSON NOT NULL COMMENT '最新货件商品响应', source_raw_id VARCHAR(191) NULL COMMENT '原始响应归档ID',
 first_seen_at DATETIME(3) NOT NULL COMMENT '首次同步时间', last_seen_at DATETIME(3) NOT NULL COMMENT '最新同步时间',
 UNIQUE KEY wfs_item_identity (tenant_id,store_id,shipment_id,item_identity), KEY wfs_item_sku (tenant_id,store_id,sku)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='Walmart WFS标准化货件SKU明细，与货件汇总数量分开保存';
