ALTER TABLE users
  ADD COLUMN username varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL COMMENT '可选登录用户名，租户内唯一，不区分大小写',
  ADD UNIQUE KEY users_tenant_username_unique (tenant_id, username);
