import { bigint, datetime, index, int, json, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const tenants = mysqlTable('tenants', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
});

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 160 }),
  username: varchar('username', { length: 64 }),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 32 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [index('users_tenant_idx').on(table.tenantId), unique('users_tenant_display_name_unique').on(table.tenantId, table.displayName), unique('users_tenant_username_unique').on(table.tenantId, table.username)]);

export const stores = mysqlTable('stores', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  marketplace: varchar('marketplace', { length: 32 }).notNull().default('walmart'),
  environment: varchar('environment', { length: 16 }).notNull().default('sandbox'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [index('stores_tenant_idx').on(table.tenantId)]);

export const rawPayloads = mysqlTable('raw_payloads', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }),
  resource: varchar('resource', { length: 80 }).notNull(),
  externalId: varchar('external_id', { length: 191 }).notNull(),
  payload: json('payload').notNull(),
  httpStatus: int('http_status').notNull(),
  correlationId: varchar('correlation_id', { length: 64 }).notNull(),
  receivedAt: datetime('received_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('raw_payload_scope_idx').on(table.tenantId, table.storeId, table.receivedAt),
  index('raw_payload_resource_store_time_idx').on(table.tenantId, table.resource, table.storeId, table.receivedAt),
]);

export const moneyColumns = {
  currency: varchar('currency', { length: 3 }).notNull(),
};
