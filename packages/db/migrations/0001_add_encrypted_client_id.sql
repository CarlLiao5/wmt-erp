ALTER TABLE `store_credentials` ADD COLUMN `encrypted_client_id` varchar(1024) NOT NULL DEFAULT '' AFTER `tenant_id`;
