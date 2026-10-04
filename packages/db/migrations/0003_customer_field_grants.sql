CREATE TABLE `customer_field_grants` (
  `tenant_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `field` varchar(32) NOT NULL,
  PRIMARY KEY (`tenant_id`, `user_id`, `field`)
);
