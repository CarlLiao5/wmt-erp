ALTER TABLE `recon_transactions`
  ADD COLUMN `period_start_date` datetime(3) NULL AFTER `transaction_date`,
  ADD COLUMN `period_end_date` datetime(3) NULL AFTER `period_start_date`;

ALTER TABLE `recon_transactions`
  DROP INDEX `recon_transaction_source_key_unique`,
  ADD UNIQUE INDEX `recon_transaction_source_key_unique` (`tenant_id`,`store_id`,`source_id`,`transaction_key`);
