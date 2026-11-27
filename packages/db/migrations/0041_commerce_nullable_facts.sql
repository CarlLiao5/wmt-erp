ALTER TABLE `order_lines`
  MODIFY COLUMN `quantity` decimal(19,4) NULL,
  MODIFY COLUMN `line_amount` decimal(19,4) NULL,
  MODIFY COLUMN `currency` varchar(8) NULL;
--> statement-breakpoint
ALTER TABLE `orders`
  MODIFY COLUMN `total_amount` decimal(19,4) NULL,
  MODIFY COLUMN `currency` varchar(8) NULL;
--> statement-breakpoint
ALTER TABLE `return_records`
  MODIFY COLUMN `amount` decimal(19,4) NULL,
  MODIFY COLUMN `returned_at` varchar(40) NULL;
