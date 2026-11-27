CREATE TABLE IF NOT EXISTS api_endpoint_catalog (
 id CHAR(64) NOT NULL PRIMARY KEY,
 service VARCHAR(64) NOT NULL COMMENT '服务标识',
 http_method VARCHAR(16) NOT NULL COMMENT 'HTTP 请求方法，HEAD/OPTIONS 自动行为不单独列出',
 endpoint_path VARCHAR(1024) NOT NULL COMMENT '包含挂载前缀的完整路由模板',
 module_name VARCHAR(191) NOT NULL COMMENT '所属功能模块',
 source_locations JSON NOT NULL COMMENT '路由定义文件与行号；多定义全部保留',
 is_active TINYINT NOT NULL DEFAULT 1 COMMENT '当前配置是否注册该路由',
 first_seen_at DATETIME(3) NOT NULL,
 last_seen_at DATETIME(3) NOT NULL,
 KEY api_endpoint_module (service,module_name,is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ERP 当前注册 API 端点目录';
