ALTER TABLE sem_item_advertising_facts
  ADD COLUMN period_start date NULL AFTER fact_date,
  ADD COLUMN period_end date NULL AFTER period_start;
