-- Keep the original table as a rollback copy. Stop cost writers while applying.
-- The atomic rename leaves each tenant with one cost record per normalized SKU.
CREATE TABLE wfs_costs_sku_identity LIKE wfs_costs;
ALTER TABLE wfs_costs_sku_identity DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id, sku);
INSERT INTO wfs_costs_sku_identity
  (tenant_id, period, sku, upc, item_id, product_name, purchase_cost, freight_cost, updated_at)
SELECT tenant_id, period, normalized_sku, kept_upc, kept_item_id, kept_product_name, purchase_cost, kept_freight_cost, updated_at
FROM (
  SELECT tenant_id, period, normalized_sku, purchase_cost, updated_at,
    FIRST_VALUE(upc) OVER (PARTITION BY tenant_id, normalized_sku ORDER BY (NULLIF(TRIM(upc),'') IS NULL), updated_at DESC, period DESC, sku) AS kept_upc,
    FIRST_VALUE(item_id) OVER (PARTITION BY tenant_id, normalized_sku ORDER BY (NULLIF(TRIM(item_id),'') IS NULL), updated_at DESC, period DESC, sku) AS kept_item_id,
    FIRST_VALUE(product_name) OVER (PARTITION BY tenant_id, normalized_sku ORDER BY (NULLIF(TRIM(product_name),'') IS NULL), updated_at DESC, period DESC, sku) AS kept_product_name,
    FIRST_VALUE(freight_cost) OVER (PARTITION BY tenant_id, normalized_sku ORDER BY (freight_cost IS NULL), updated_at DESC, period DESC, sku) AS kept_freight_cost,
    ROW_NUMBER() OVER (PARTITION BY tenant_id, normalized_sku ORDER BY updated_at DESC, period DESC, sku) AS sequence_no
  FROM (SELECT c.*, UPPER(TRIM(sku)) AS normalized_sku FROM wfs_costs c) source_costs
) merged WHERE sequence_no=1;
RENAME TABLE wfs_costs TO wfs_costs_before_sku_identity, wfs_costs_sku_identity TO wfs_costs;
ALTER TABLE wfs_costs COMMENT='SKU 成本表，每租户每 SKU 唯一，导入空白字段保留原值';
ALTER TABLE wfs_costs_before_sku_identity COMMENT='0066 成本表按 SKU 合并前的原始备份';
