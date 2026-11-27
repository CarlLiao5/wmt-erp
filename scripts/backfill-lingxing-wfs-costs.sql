INSERT INTO wfs_costs (tenant_id, period, sku, upc, item_id, product_name, purchase_cost, freight_cost)
SELECT l.tenant_id, 'lingxing', l.walmart_sku, '', '', l.product_name, l.unit_cost, NULL
FROM (
  SELECT tenant_id, UPPER(TRIM(msku)) COLLATE utf8mb4_0900_ai_ci AS walmart_sku,
         COALESCE(LEFT(MAX(NULLIF(TRIM(product_name), '')), 255), '') AS product_name,
         SUM(line_purchase_cost) / SUM(shipped_quantity) AS unit_cost
  FROM lingxing_shipment_sku_costs
  WHERE shipping_status='2' AND currency='CNY'
    AND shipped_quantity>0 AND purchase_unit_cost>0 AND line_purchase_cost>0
    AND NULLIF(TRIM(msku),'') IS NOT NULL AND NULLIF(TRIM(sku),'') IS NOT NULL
  GROUP BY tenant_id, walmart_sku
  HAVING COUNT(DISTINCT UPPER(TRIM(sku)))=1
) l
WHERE EXISTS (SELECT 1 FROM wfs_costs c WHERE c.tenant_id=l.tenant_id COLLATE utf8mb4_0900_ai_ci)
  AND NOT EXISTS (
    SELECT 1 FROM wfs_costs c
    WHERE c.tenant_id=l.tenant_id COLLATE utf8mb4_0900_ai_ci AND c.sku=l.walmart_sku
  )
ON DUPLICATE KEY UPDATE freight_cost=wfs_costs.freight_cost;
