ALTER TABLE product_reviews
  ADD COLUMN review_item_id VARCHAR(191) NULL COMMENT '评论实际所属商品 Item ID，区别于抓取入口 item_id',
  ADD COLUMN review_item_name TEXT NULL COMMENT '评论原始商品名称',
  ADD COLUMN review_item_image_url TEXT NULL COMMENT '评论原始商品图片地址',
  ADD COLUMN review_features JSON NULL COMMENT '评论原始变体规格名称和值列表',
  ADD INDEX review_variant_list (tenant_id, item_id, review_item_id, published_at);
