-- Cover dashboard receipt aggregation without fetching every log's clustered row.
CREATE INDEX `wfs_inventory_logs_receipt_cover_idx`
  ON `wfs_inventory_logs` (`tenant_id`, `shipment_id`, `store_id`, `sku`, `reason_description`, `changed_units`);
