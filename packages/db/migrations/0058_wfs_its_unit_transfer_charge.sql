ALTER TABLE wfs_fee_preview_items
  ADD COLUMN unit_transfer_charge DECIMAL(19,4) NULL COMMENT 'API unitTransferCharge; NULL when not provided';
