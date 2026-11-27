import { datetime, decimal, index, int, json, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const targetBatches = mysqlTable('target_batches', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  month: varchar('month', { length: 7 }).notNull(),
  revision: int('revision').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull(),
  formulaVersion: varchar('formula_version', { length: 40 }).notNull(),
  sourceSnapshotAt: datetime('source_snapshot_at', { mode: 'date', fsp: 3 }),
  createdBy: varchar('created_by', { length: 36 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('target_batches_tenant_month_revision_unique').on(table.tenantId, table.month, table.revision),
  index('target_batches_scope_idx').on(table.tenantId, table.month, table.status),
]);

export const skuTargetRows = mysqlTable('sku_target_rows', {
  id: varchar('id', { length: 36 }).primaryKey(),
  batchId: varchar('batch_id', { length: 36 }).notNull(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  month: varchar('month', { length: 7 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  sku: varchar('sku', { length: 191 }).notNull(),
  itemId: varchar('item_id', { length: 191 }),
  productName: varchar('product_name', { length: 512 }),
  ownerName: varchar('owner_name', { length: 191 }),
  inventoryQuantity: decimal('inventory_quantity', { precision: 19, scale: 4 }),
  lastMonthUnits: decimal('last_month_units', { precision: 19, scale: 4 }),
  lastMonthDays: int('last_month_days'),
  lastMonthAvgDailySales: decimal('last_month_avg_daily_sales', { precision: 19, scale: 6 }),
  lastMonthAvgPrice: decimal('last_month_avg_price', { precision: 19, scale: 4 }),
  expectedDailySales: decimal('expected_daily_sales', { precision: 19, scale: 6 }),
  sellingDays: decimal('selling_days', { precision: 19, scale: 6 }),
  quantityTarget: decimal('quantity_target', { precision: 19, scale: 6 }),
  amountTarget: decimal('amount_target', { precision: 19, scale: 4 }),
  missingReasons: json('missing_reasons'),
  status: varchar('status', { length: 20 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('sku_target_rows_batch_store_sku_unique').on(table.batchId, table.storeId, table.sku),
  index('sku_target_rows_scope_idx').on(table.tenantId, table.month, table.storeId, table.sku),
  index('sku_target_rows_batch_idx').on(table.batchId),
]);
