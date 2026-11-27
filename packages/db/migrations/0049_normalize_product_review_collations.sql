-- Keep all product-review tables on the ERP default collation so snapshot
-- subqueries can compare tenant_id and item_id without implicit conflicts.
ALTER TABLE product_review_configs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE product_review_targets CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE product_reviews CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE product_review_runs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE product_review_pages CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE product_review_snapshots CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
