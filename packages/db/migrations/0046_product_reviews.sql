CREATE TABLE IF NOT EXISTS product_review_configs (
 tenant_id varchar(36) PRIMARY KEY, encrypted_api_key text NOT NULL, updated_at datetime(3) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS product_review_targets (
 id varchar(36) PRIMARY KEY, tenant_id varchar(36) NOT NULL, item_id varchar(191) NOT NULL,
 enabled int NOT NULL DEFAULT 0, next_run_at datetime(3), last_success_at datetime(3),
 initial_status varchar(32) NOT NULL DEFAULT 'pending', next_page_url text, status varchar(32) NOT NULL DEFAULT 'idle',
 stop_requested int NOT NULL DEFAULT 0, pages_read int NOT NULL DEFAULT 0, last_error varchar(500),
 created_at datetime(3) NOT NULL, updated_at datetime(3) NOT NULL,
 UNIQUE KEY review_target_unique(tenant_id,item_id), KEY review_target_due(enabled,next_run_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS product_reviews (
 id varchar(36) PRIMARY KEY, tenant_id varchar(36) NOT NULL, item_id varchar(191) NOT NULL,
 review_key varchar(191) NOT NULL, rating int NOT NULL, title text, body text, published_at datetime(3),
 author varchar(500), verified_purchase int, source_url text NOT NULL, raw_payload json,
 first_seen_at datetime(3) NOT NULL, last_seen_at datetime(3) NOT NULL,
 UNIQUE KEY review_unique(tenant_id,item_id,review_key), KEY review_list(tenant_id,item_id,published_at,review_key)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS product_review_runs (
 id varchar(191) PRIMARY KEY, tenant_id varchar(36) NOT NULL, item_id varchar(191) NOT NULL, mode varchar(32) NOT NULL,
 status varchar(32) NOT NULL, pages_read int NOT NULL DEFAULT 0, reviews_written int NOT NULL DEFAULT 0,
 error_message varchar(500), started_at datetime(3) NOT NULL, ended_at datetime(3), KEY review_run_scope(tenant_id,item_id,started_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS product_review_pages (
 id varchar(36) PRIMARY KEY, tenant_id varchar(36) NOT NULL, item_id varchar(191) NOT NULL,
 run_id varchar(191) NOT NULL, mode varchar(32) NOT NULL, source_url text NOT NULL, url_hash varchar(64) NOT NULL,
 batch_id varchar(191), status varchar(32) NOT NULL, content_hash varchar(64), next_page_url text,
 credits_used decimal(12,4), updated_at datetime(3) NOT NULL,
 UNIQUE KEY review_page_unique(run_id,url_hash), KEY review_page_resume(tenant_id,item_id,mode,status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
