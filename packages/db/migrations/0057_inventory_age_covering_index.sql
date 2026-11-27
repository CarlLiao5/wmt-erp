-- Avoid table-row reads for each age bucket when loading the latest inventory.
ALTER TABLE wfs_inventory_age_buckets
  ADD INDEX wfs_inventory_age_cover_idx (tenant_id,snapshot_id,bucket_name,quantity),
  ALGORITHM=INPLACE, LOCK=NONE;
