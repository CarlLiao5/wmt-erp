-- Normalize legacy advertising report text columns to the ERP default collation.
-- This changes comparison metadata only; report values are preserved.
ALTER TABLE ad_item_report CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ad_keyword_report CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ad_Placement CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
