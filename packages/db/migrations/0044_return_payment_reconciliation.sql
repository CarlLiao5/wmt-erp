ALTER TABLE recon_transactions
 ADD COLUMN customer_order_id varchar(191) NULL,
 ADD COLUMN purchase_order_id varchar(191) NULL,
 ADD COLUMN sku varchar(191) NULL,
 ADD COLUMN amount_type varchar(191) NULL,
 ADD INDEX recon_customer_order_idx (tenant_id, store_id, customer_order_id),
 ADD INDEX recon_purchase_order_idx (tenant_id, store_id, purchase_order_id);
