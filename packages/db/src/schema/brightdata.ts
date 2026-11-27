import { datetime, decimal, index, int, json, mysqlTable, text, unique, varchar } from 'drizzle-orm/mysql-core';

export const brightdataItemNames = mysqlTable('brightdata_item_names', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }),
  itemId: varchar('item_id', { length: 191 }).notNull(),
  productName: varchar('product_name', { length: 1000 }),
  sourceRowId: varchar('source_row_id', { length: 191 }),
  rawPayload: json('raw_payload'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('brightdata_item_names_tenant_item_unique').on(table.tenantId, table.itemId),
  index('brightdata_item_names_scope_idx').on(table.tenantId, table.storeId),
  index('brightdata_item_names_source_idx').on(table.tenantId, table.sourceRowId),
]);

export const brightdataProductInventory = mysqlTable('brightdata_product_inventory', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }),
  sourceItemId: varchar('source_item_id', { length: 36 }),
  itemId: varchar('item_id', { length: 191 }).notNull(),
  runId: varchar('run_id', { length: 36 }).notNull(),
  productName: varchar('product_name', { length: 1000 }),
  availableQuantity: int('available_quantity'),
  queriedAt: datetime('queried_at', { mode: 'date', fsp: 3 }).notNull(),
  price: decimal('price', { precision: 19, scale: 4 }),
  description: text('description'),
  rating: decimal('rating', { precision: 5, scale: 2 }),
  reviewCount: int('review_count'),
  rawPayload: json('raw_payload'),
  idempotencyKey: varchar('idempotency_key', { length: 191 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('brightdata_product_inventory_idempotency_unique').on(table.tenantId, table.idempotencyKey),
  index('brightdata_product_inventory_scope_time_idx').on(table.tenantId, table.itemId, table.queriedAt),
  index('brightdata_product_inventory_snapshot_idx').on(table.tenantId, table.queriedAt),
  index('brightdata_product_inventory_run_idx').on(table.tenantId, table.runId),
]);

export const brightdataRunHistory = mysqlTable('brightdata_run_history', {
  runId: varchar('run_id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  startedAt: datetime('started_at', { mode: 'date', fsp: 3 }).notNull(),
  endedAt: datetime('ended_at', { mode: 'date', fsp: 3 }),
  totalItems: int('total_items').notNull().default(0),
  successCount: int('success_count').notNull().default(0),
  failCount: int('fail_count').notNull().default(0),
  status: varchar('status', { length: 32 }).notNull(),
  errorMessage: text('error_message'),
}, (table) => [
  index('brightdata_run_history_tenant_started_idx').on(table.tenantId, table.startedAt),
]);

export const brightdataSyncSchedules = mysqlTable('brightdata_sync_schedules', {
  tenantId: varchar('tenant_id', { length: 36 }).primaryKey(),
  enabled: int('enabled').notNull().default(0),
  timezone: varchar('timezone', { length: 32 }).notNull().default('Asia/Shanghai'),
  nextRunAt: datetime('next_run_at', { mode: 'date', fsp: 3 }),
  lastRunAt: datetime('last_run_at', { mode: 'date', fsp: 3 }),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [index('brightdata_sync_schedules_due_idx').on(table.enabled, table.nextRunAt)]);
