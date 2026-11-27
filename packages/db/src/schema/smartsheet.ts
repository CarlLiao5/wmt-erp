import { datetime, index, json, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const smartSheetAllSkuRows = mysqlTable('smartsheet_allsku_rows', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  sourceRowId: varchar('source_row_id', { length: 191 }).notNull(),
  sku: varchar('sku',{length:191}), itemId: varchar('item_id',{length:191}), productName: varchar('product_name',{length:500}), storeName: varchar('store_name',{length:255}), ownerName: varchar('owner_name',{length:255}), payload: json('payload').notNull(),
  batchId: varchar('batch_id', { length: 64 }).notNull(),
  syncedAt: datetime('synced_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('smartsheet_allsku_source_unique').on(table.tenantId, table.sourceRowId),
  index('smartsheet_allsku_tenant_updated_idx').on(table.tenantId, table.updatedAt),
]);
