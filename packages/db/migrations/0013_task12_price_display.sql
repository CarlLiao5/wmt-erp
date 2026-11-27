ALTER TABLE price_snapshots
  ADD COLUMN buy_box_base_price decimal(19,4) NULL AFTER target_price,
  ADD COLUMN buy_box_total_price decimal(19,4) NULL AFTER buy_box_base_price,
  ADD COLUMN comparison_price decimal(19,4) NULL AFTER buy_box_total_price,
  ADD COLUMN competitor_price decimal(19,4) NULL AFTER comparison_price,
  ADD COLUMN promotion_type varchar(64) NULL AFTER promotion,
  ADD COLUMN show_strikethrough int NULL AFTER promotion_type;
