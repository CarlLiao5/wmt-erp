import { datetime, decimal, index, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const returnStatusEvents = mysqlTable('return_status_events', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  returnId: varchar('return_id', { length: 191 }).notNull(),
  sourceIdentity: varchar('source_identity', { length: 191 }).notNull(),
  status: varchar('status', { length: 80 }).notNull(),
  refundAmount: decimal('refund_amount', { precision: 19, scale: 4 }),
  returnedAt: datetime('returned_at', { mode: 'date', fsp: 3 }),
  rawResponseId: varchar('raw_response_id', { length: 191 }),
  recordedAt: datetime('recorded_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('return_status_event_source_unique').on(table.storeId, table.sourceIdentity),
  index('return_status_event_scope_idx').on(table.tenantId, table.storeId, table.returnId, table.returnedAt),
  index('return_status_event_tenant_date_idx').on(table.tenantId, table.returnedAt),
]);
