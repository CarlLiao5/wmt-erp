ALTER TABLE recon_transactions
 ADD COLUMN purchase_order_line varchar(32) NULL,
 ADD COLUMN ship_qty decimal(19,4) NULL,
 ADD COLUMN bill_transaction_key varchar(191) NULL,
 ADD INDEX recon_sku_fee_idx (tenant_id,sku);
