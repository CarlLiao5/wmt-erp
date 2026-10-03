import { boolean, datetime, index, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';
import { stores, tenants, users } from './common.js';

export const storeAssignments = mysqlTable('store_assignments', {
  tenantId: varchar('tenant_id', { length: 36 }).notNull(), userId: varchar('user_id', { length: 36 }).notNull(), storeId: varchar('store_id', { length: 36 }).notNull(),
  validFrom: datetime('valid_from', { mode: 'date', fsp: 3 }).notNull(), validUntil: datetime('valid_until', { mode: 'date', fsp: 3 }),
}, (table) => [primaryKey({ columns: [table.tenantId, table.userId, table.storeId] }), index('store_assignment_valid_idx').on(table.validFrom, table.validUntil)]);

export const skuAssignments = mysqlTable('sku_assignments', {
  tenantId: varchar('tenant_id', { length: 36 }).notNull(), userId: varchar('user_id', { length: 36 }).notNull(), skuId: varchar('sku_id', { length: 36 }).notNull(),
  validFrom: datetime('valid_from', { mode: 'date', fsp: 3 }).notNull(), validUntil: datetime('valid_until', { mode: 'date', fsp: 3 }),
}, (table) => [primaryKey({ columns: [table.tenantId, table.userId, table.skuId] })]);

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 64 }).primaryKey(), tenantId: varchar('tenant_id', { length: 36 }).notNull(), userId: varchar('user_id', { length: 36 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(), createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [index('sessions_expiry_idx').on(table.expiresAt)]);

export const credentials = mysqlTable('store_credentials', {
  storeId: varchar('store_id', { length: 36 }).primaryKey(), tenantId: varchar('tenant_id', { length: 36 }).notNull(), encryptedSecret: varchar('encrypted_secret', { length: 1024 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
});
