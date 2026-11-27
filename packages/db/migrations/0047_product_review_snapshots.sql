CREATE TABLE product_review_snapshots (
  id varchar(36) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  item_id varchar(191) NOT NULL,
  captured_at datetime(3) NOT NULL,
  average_rating decimal(4,2) NULL,
  total_review_count int NULL,
  one_star_count int NULL, two_star_count int NULL, three_star_count int NULL, four_star_count int NULL, five_star_count int NULL,
  one_star_pct decimal(6,3) NULL, two_star_pct decimal(6,3) NULL, three_star_pct decimal(6,3) NULL, four_star_pct decimal(6,3) NULL, five_star_pct decimal(6,3) NULL,
  source_url text NOT NULL,
  raw_payload json NULL,
  PRIMARY KEY (id),
  KEY review_snapshot_scope (tenant_id,item_id,captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
