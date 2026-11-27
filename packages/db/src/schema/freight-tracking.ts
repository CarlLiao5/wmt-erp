import { datetime, index, int, json, mysqlTable, text, unique, varchar, bigint } from 'drizzle-orm/mysql-core';

export const freightTrackingRoutes = mysqlTable('freight_tracking_routes', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  freightForwarderInboundNumber: varchar('freight_forwarder_inbound_number', { length: 191 }).notNull(),
  brand: varchar('brand', { length: 32 }).notNull(),
  currentStatus: varchar('current_status', { length: 32 }).notNull(),
  currentStatusText: varchar('current_status_text', { length: 200 }).notNull(),
  lastEventAt: datetime('last_event_at', { mode: 'date', fsp: 3 }),
  lastFetchedAt: datetime('last_fetched_at', { mode: 'date', fsp: 3 }).notNull(),
  lastSuccessfulBatchId: varchar('last_successful_batch_id', { length: 64 }).notNull(),
  rawPayloadId: bigint('raw_payload_id', { mode: 'number', unsigned: true }).notNull(),
  sourceHeadFreightRowIds: json('source_head_freight_row_ids').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('freight_tracking_tenant_inbound_unique').on(table.tenantId, table.freightForwarderInboundNumber),
  index('freight_tracking_status_idx').on(table.tenantId, table.currentStatus, table.lastEventAt),
  index('freight_tracking_batch_idx').on(table.tenantId, table.lastSuccessfulBatchId),
]);

export const freightTrackingEvents = mysqlTable('freight_tracking_events', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 }).notNull(),
  routeId: varchar('route_id', { length: 64 }).notNull(),
  routeOrder: int('route_order').notNull(),
  eventTimeText: varchar('event_time_text', { length: 191 }).notNull(),
  eventAt: datetime('event_at', { mode: 'date', fsp: 3 }),
  info: text('info').notNull(),
  eventCode: varchar('event_code', { length: 64 }).notNull(),
  raw: json('raw').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  unique('freight_tracking_event_route_order_unique').on(table.routeId, table.routeOrder),
  index('freight_tracking_events_scope_idx').on(table.tenantId, table.routeId, table.eventAt),
]);
