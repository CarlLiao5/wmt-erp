import { datetime, index, int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
export const wfsInventoryLogs = mysqlTable('wfs_inventory_logs', {
  id: varchar('id', { length: 191 }).primaryKey(), tenantId: varchar('tenant_id', { length: 36 }).notNull(), storeId: varchar('store_id', { length: 36 }).notNull(), sku: varchar('sku', { length: 191 }).notNull(), gtin: varchar('gtin', { length: 32 }).notNull(), fcId: varchar('fc_id', { length: 64 }), fcName: varchar('fc_name', { length: 128 }), changedUnits: int('changed_units'), transactionTime: datetime('transaction_time', { mode: 'date', fsp: 3 }), transactionLocation: varchar('transaction_location', { length: 128 }), reasonCode: varchar('reason_code', { length: 64 }), reasonDescription: varchar('reason_description', { length: 255 }), transactionType: varchar('transaction_type', { length: 64 }), shipmentId: varchar('shipment_id', { length: 128 }), createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('wfs_inventory_logs_scope_idx').on(table.tenantId, table.storeId, table.sku, table.transactionTime),
  index('wfs_inventory_logs_receipt_cover_idx').on(table.tenantId, table.shipmentId, table.storeId, table.sku, table.reasonDescription, table.changedUnits),
  index('wfs_inventory_logs_shipment_idx').on(table.tenantId, table.shipmentId, table.storeId),
]);
