import { date, datetime, decimal, index, int, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

export const semSearchTermsDaily = mysqlTable('sem_search_terms_daily', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  reportDate: date('report_date').notNull(),
  campaignId: varchar('campaign_id', { length: 191 }).notNull(),
  campaignName: varchar('campaign_name', { length: 255 }),
  searchTerm: varchar('search_term', { length: 500 }).notNull(),
  sku: varchar('sku', { length: 191 }).notNull(),
  itemId: varchar('item_id', { length: 191 }),
  impressions: int('impressions'),
  clicks: int('clicks'),
  ctr: decimal('ctr', { precision: 19, scale: 8 }),
  adSpend: decimal('ad_spend', { precision: 19, scale: 4 }),
  currency: varchar('currency', { length: 3 }).default('USD'),
  sourceId: varchar('source_id', { length: 191 }).notNull(),
  payload: json('payload'),
  receivedAt: datetime('received_at', { mode: 'date', fsp: 3 }).notNull(),
}, (t) => [index('sem_search_terms_daily_scope_idx').on(t.tenantId, t.storeId, t.reportDate, t.sku)]);
