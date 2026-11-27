ALTER TABLE advertising_facts
  ADD COLUMN channel varchar(16) NOT NULL DEFAULT 'onsite' AFTER store_id,
  DROP INDEX advertising_fact_source_unique,
  DROP INDEX advertising_fact_scope_idx,
  ADD UNIQUE KEY advertising_fact_source_unique (store_id, channel, fact_date, campaign_id, source_id),
  ADD KEY advertising_fact_scope_idx (tenant_id, store_id, channel, fact_date);
