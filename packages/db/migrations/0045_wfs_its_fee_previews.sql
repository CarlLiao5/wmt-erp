CREATE TABLE wfs_fee_preview_runs (
  id varchar(64) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  store_id varchar(36) NOT NULL,
  shipment_id varchar(191) NOT NULL,
  inbound_order_id varchar(191) NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(32) NOT NULL,
  skip_reason varchar(64) NULL,
  last_attempt_at datetime(3) NOT NULL,
  last_success_at datetime(3) NULL,
  last_error varchar(1000) NULL,
  created_at datetime(3) NOT NULL,
  updated_at datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY wfs_fee_preview_run_identity_unique (tenant_id, store_id, shipment_id),
  KEY wfs_fee_preview_run_scope_idx (tenant_id, store_id, status)
);

CREATE TABLE wfs_fee_preview_options (
  id varchar(64) NOT NULL,
  run_id varchar(64) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  store_id varchar(36) NOT NULL,
  shipment_id varchar(191) NOT NULL,
  preview_type varchar(64) NOT NULL,
  ship_node varchar(64) NOT NULL,
  destination_name varchar(191) NULL,
  total_net_transfer_charge decimal(19,4) NULL,
  currency varchar(8) NULL,
  raw_response json NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY wfs_fee_preview_option_identity_unique (tenant_id, store_id, shipment_id, preview_type, ship_node),
  KEY wfs_fee_preview_options_scope_idx (tenant_id, store_id, shipment_id)
);

CREATE TABLE wfs_fee_preview_items (
  id varchar(64) NOT NULL,
  option_id varchar(64) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  store_id varchar(36) NOT NULL,
  shipment_id varchar(191) NOT NULL,
  product_identity varchar(191) NOT NULL,
  gtin varchar(32) NULL,
  sku varchar(191) NULL,
  item_quantity int NULL,
  net_transfer_charge decimal(19,4) NULL,
  currency varchar(8) NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY wfs_fee_preview_item_product_unique (option_id, product_identity),
  KEY wfs_fee_preview_items_scope_idx (tenant_id, store_id, shipment_id, sku)
);
