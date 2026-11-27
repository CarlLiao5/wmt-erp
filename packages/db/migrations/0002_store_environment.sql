ALTER TABLE `stores` ADD COLUMN `environment` varchar(16) NOT NULL DEFAULT 'sandbox' AFTER `marketplace`;
