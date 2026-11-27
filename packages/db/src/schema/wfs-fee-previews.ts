import { datetime, decimal, index, int, json, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';

export const wfsFeePreviewRuns = mysqlTable('wfs_fee_preview_runs', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  shipmentId: varchar('shipment_id', { length: 191 }).notNull(),
  inboundOrderId: varchar('inbound_order_id', { length: 191 }),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  skipReason: varchar('skip_reason', { length: 64 }),
  lastAttemptAt: datetime('last_attempt_at', { mode: 'date', fsp: 3 }).notNull(),
  lastSuccessAt: datetime('last_success_at', { mode: 'date', fsp: 3 }),
  lastError: varchar('last_error', { length: 1000 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('wfs_fee_preview_run_identity_unique').on(table.tenantId, table.storeId, table.shipmentId),
  index('wfs_fee_preview_run_scope_idx').on(table.tenantId, table.storeId, table.status),
]);

export const wfsFeePreviewOptions = mysqlTable('wfs_fee_preview_options', {
  id: varchar('id', { length: 64 }).primaryKey(),
  runId: varchar('run_id', { length: 64 }).notNull(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  shipmentId: varchar('shipment_id', { length: 191 }).notNull(),
  previewType: varchar('preview_type', { length: 64 }).notNull(),
  shipNode: varchar('ship_node', { length: 64 }).notNull(),
  destinationName: varchar('destination_name', { length: 191 }),
  totalNetTransferCharge: decimal('total_net_transfer_charge', { precision: 19, scale: 4 }),
  currency: varchar('currency', { length: 8 }),
  rawResponse: json('raw_response').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('wfs_fee_preview_option_identity_unique').on(table.tenantId, table.storeId, table.shipmentId, table.previewType, table.shipNode),
  index('wfs_fee_preview_options_scope_idx').on(table.tenantId, table.storeId, table.shipmentId),
]);

export const wfsFeePreviewItems = mysqlTable('wfs_fee_preview_items', {
  id: varchar('id', { length: 64 }).primaryKey(),
  optionId: varchar('option_id', { length: 64 }).notNull(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  storeId: varchar('store_id', { length: 36 }).notNull(),
  shipmentId: varchar('shipment_id', { length: 191 }).notNull(),
  productIdentity: varchar('product_identity', { length: 191 }).notNull(),
  gtin: varchar('gtin', { length: 32 }),
  sku: varchar('sku', { length: 191 }),
  itemQuantity: int('item_quantity'),
  netTransferCharge: decimal('net_transfer_charge', { precision: 19, scale: 4 }),
  unitTransferCharge: decimal('unit_transfer_charge', { precision: 19, scale: 4 }),
  currency: varchar('currency', { length: 8 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('wfs_fee_preview_item_product_unique').on(table.optionId, table.productIdentity),
  index('wfs_fee_preview_items_scope_idx').on(table.tenantId, table.storeId, table.shipmentId, table.sku),
]);
