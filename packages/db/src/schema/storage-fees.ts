import { decimal, datetime, index, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const storageFees = mysqlTable('storage_fees', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  month: varchar('month', { length: 7 }).notNull(),
  feeType: varchar('fee_type', { length: 128 }).notNull(),
  amount: decimal('amount', { precision: 19, scale: 4 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  sourceId: varchar('source_id', { length: 191 }).notNull(),
  receivedAt: datetime('received_at', { mode: 'date', fsp: 3 }).notNull(),
}, (t) => [unique('storage_fee_source_unique').on(t.storeId, t.month, t.feeType, t.sourceId), index('storage_fee_scope_idx').on(t.tenantId, t.storeId, t.month)]);
