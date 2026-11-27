ALTER TABLE `return_records`
  ADD COLUMN `refund_covered_by` varchar(64) NULL,
  ADD COLUMN `refund_channel_covered_by` varchar(64) NULL,
  ADD COLUMN `is_return_for_exception` tinyint NULL,
  ADD COLUMN `return_channel_name` varchar(128) NULL;
