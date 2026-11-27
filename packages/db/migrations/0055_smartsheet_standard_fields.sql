ALTER TABLE `smartsheet_allsku_rows`
  ADD COLUMN `sku` VARCHAR(191) NULL COMMENT '标准SKU' AFTER `source_row_id`,
  ADD COLUMN `item_id` VARCHAR(191) NULL COMMENT '标准Item ID' AFTER `sku`,
  ADD COLUMN `product_name` VARCHAR(500) NULL COMMENT '中文品名' AFTER `item_id`,
  ADD COLUMN `store_name` VARCHAR(255) NULL COMMENT '店铺名称' AFTER `product_name`,
  ADD COLUMN `owner_name` VARCHAR(255) NULL COMMENT '当前负责人' AFTER `store_name`,
  ADD KEY `smartsheet_allsku_sku_idx` (`tenant_id`,`sku`),
  ADD KEY `smartsheet_allsku_item_idx` (`tenant_id`,`item_id`);
