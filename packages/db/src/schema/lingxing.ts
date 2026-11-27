import { datetime, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

export const lingxingConfigs = mysqlTable('lingxing_configs', {
  tenantId: varchar('tenant_id', { length: 36 }).primaryKey(),
  encryptedMcpKey: varchar('encrypted_mcp_key', { length: 1024 }).notNull(),
  advertiserIds: varchar('advertiser_ids', { length: 2048 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
});
