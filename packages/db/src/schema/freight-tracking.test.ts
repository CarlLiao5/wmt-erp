import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { freightTrackingEvents, freightTrackingRoutes } from './index.js';

describe('freight tracking schema', () => {
  it('defines tenant-scoped latest route columns and source links', () => {
    expect(freightTrackingRoutes.freightForwarderInboundNumber.name).toBe('freight_forwarder_inbound_number');
    expect(freightTrackingRoutes.tenantId.notNull).toBe(true);
    expect(freightTrackingRoutes.currentStatus.name).toBe('current_status');
    expect(freightTrackingRoutes.lastEventAt.name).toBe('last_event_at');
    expect(freightTrackingRoutes.sourceHeadFreightRowIds.name).toBe('source_head_freight_row_ids');
    expect(freightTrackingRoutes.rawPayloadId.name).toBe('raw_payload_id');
  });

  it('keeps one route per tenant and one event per route order', () => {
    const routeConfig = getTableConfig(freightTrackingRoutes);
    const eventConfig = getTableConfig(freightTrackingEvents);
    expect(routeConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain('freight_tracking_tenant_inbound_unique');
    expect(eventConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain('freight_tracking_event_route_order_unique');
    expect(freightTrackingEvents.routeId.name).toBe('route_id');
    expect(freightTrackingEvents.routeOrder.name).toBe('route_order');
    expect(eventConfig.indexes.map((index) => index.config.name)).toContain('freight_tracking_events_scope_idx');
  });
});
