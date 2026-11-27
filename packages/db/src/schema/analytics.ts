import { date, decimal, index, json, mysqlTable, unique, varchar, datetime } from 'drizzle-orm/mysql-core';
export const dailyFacts = mysqlTable('daily_facts', { id: varchar('id',{length:36}).primaryKey(), tenantId: varchar('tenant_id',{length:36}).notNull(), storeId: varchar('store_id',{length:36}).notNull(), factDate: date('fact_date').notNull(), metric: varchar('metric',{length:80}).notNull(), value: decimal('value',{precision:19,scale:4}).notNull(), currency: varchar('currency',{length:3}) }, (t)=>[unique('daily_fact_unique').on(t.storeId,t.factDate,t.metric), index('daily_fact_scope_idx').on(t.tenantId,t.storeId,t.factDate)]);

export const targetImports = mysqlTable('target_imports', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  createdBy: varchar('created_by', { length: 36 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  errors: json('errors'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (t) => [index('target_import_scope_idx').on(t.tenantId, t.createdAt)]);

export const targetImportRows = mysqlTable('target_import_rows', {
  id: varchar('id', { length: 36 }).primaryKey(),
  importId: varchar('import_id', { length: 36 }).notNull(),
  lineNo: decimal('line_no', { precision: 10, scale: 0 }).notNull(),
  month: varchar('month', { length: 7 }),
  storeId: varchar('store_id', { length: 36 }),
  target: decimal('target', { precision: 19, scale: 4 }),
  raw: json('raw'),
}, (t) => [index('target_import_rows_import_idx').on(t.importId, t.lineNo)]);

export const salesTargets = mysqlTable('sales_targets', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  importId: varchar('import_id', { length: 36 }).notNull(),
  month: varchar('month', { length: 7 }).notNull(),
  storeId: varchar('store_id', { length: 36 }),
  target: decimal('target', { precision: 19, scale: 4 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (t) => [unique('sales_targets_tenant_month_store_unique').on(t.tenantId, t.month, t.storeId), index('sales_targets_scope_idx').on(t.tenantId, t.month, t.storeId)]);
