import { datetime, index, json, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const paymentReports = mysqlTable('payment_reports', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  statementMonth: varchar('statement_month', { length: 7 }).notNull(),
  sourceId: varchar('source_id', { length: 191 }).notNull(),
  payload: json('payload').notNull(),
  receivedAt: datetime('received_at', { mode: 'date', fsp: 3 }).notNull(),
}, (t) => [unique('payment_report_source_unique').on(t.storeId, t.sourceId), index('payment_report_scope_idx').on(t.tenantId, t.storeId, t.statementMonth)]);
