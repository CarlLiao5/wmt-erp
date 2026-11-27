import express from 'express';
import { describe, expect, it } from 'vitest';
import { brightDataRouter, type BrightDataInventoryRow, type BrightDataItemRow } from './brightdata.js';

const inventory: BrightDataInventoryRow[] = [
  { id: 'snapshot-1', tenantId: 'tenant-1', storeId: 'store-hidden', itemId: 'ITEM-1', runId: 'run-1', productName: 'Widget', availableQuantity: null, queriedAt: '2026-10-18T00:00:00.000Z', price: '12.50', rating: '4.5', reviewCount: 8 },
  { id: 'snapshot-2', tenantId: 'tenant-1', storeId: 'store-hidden', itemId: 'ITEM-2', runId: 'run-1', productName: 'Gadget', availableQuantity: 4, queriedAt: '2026-10-19T00:00:00.000Z', price: '8.00', rating: '4.0', reviewCount: 3 },
];
const items: BrightDataItemRow[] = [
  { id: 'name-1', tenantId: 'tenant-1', storeId: 'store-hidden', itemId: 'ITEM-1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' },
  { id: 'name-2', tenantId: 'tenant-1', storeId: 'store-hidden', itemId: 'ITEM-2', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' },
];

function testApp() {
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
  app.use(brightDataRouter({
    visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(['other-store']), skus: new Set(['other-store:OTHER']) }),
    inventory: async () => inventory,
    items: async () => items,
  }));
  return app;
}

describe('Bright Data routes', () => {
  it('returns the tenant schedule state and updates the enabled flag', async () => {
    let enabled = false;
    const app = express();
    app.use(express.json());
    app.use(brightDataRouter({
      visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set() }),
      schedule: async () => ({ enabled, timezone: 'Asia/Shanghai', nextRunAt: enabled ? '2026-10-21T08:00:00.000Z' : null, lastRunAt: null }),
      setSchedule: async (_tenantId, value) => { enabled = value; return { enabled, timezone: 'Asia/Shanghai', nextRunAt: enabled ? '2026-10-21T08:00:00.000Z' : null, lastRunAt: null }; },
    }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const before = await fetch(`http://127.0.0.1:${address.port}/brightdata/schedule`);
      expect((await before.json() as { data: { enabled: boolean; timezone: string } }).data).toMatchObject({ enabled: false, timezone: 'Asia/Shanghai' });
      const changed = await fetch(`http://127.0.0.1:${address.port}/brightdata/schedule`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      expect(changed.status).toBe(200);
      expect((await changed.json() as { data: { enabled: boolean; nextRunAt: string } }).data).toMatchObject({ enabled: true, nextRunAt: '2026-10-21T08:00:00.000Z' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('creates a product in the authenticated tenant', async () => {
    let created: BrightDataItemRow | undefined;
    const app = express();
    app.use(express.json());
    app.use(brightDataRouter({
      visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set() }),
      items: async () => created ? [created] : [],
      createItem: async (tenantId, input) => {
        created = { id: 'name-3', tenantId, itemId: input.itemId, productName: input.productName, rawPayload: { category: input.category }, createdAt: new Date(), updatedAt: new Date() };
        return created;
      },
    }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: 'ITEM-3', productName: 'New product', category: 'Kitchen' }) });
      const body = await response.json() as { data: BrightDataItemRow };
      expect(response.status).toBe(201);
      expect(body.data.itemId).toBe('ITEM-3');
      expect(created?.rawPayload).toEqual({ category: 'Kitchen' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('requires product category when creating a product', async () => {
    const app = express();
    app.use(express.json());
    app.use(brightDataRouter({ visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set() }), createItem: async () => { throw new Error('should not create'); } }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: 'ITEM-3', productName: 'New product' }) });
      expect(response.status).toBe(400);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('returns tenant inventory to a member without store or SKU filtering', async () => {
    const app = testApp();
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/inventory?itemId=ITEM&page=1&pageSize=1`);
      const body = await response.json() as { data: { rows: BrightDataInventoryRow[]; pagination: { total: number; pageSize: number } } };
      expect(response.status).toBe(200);
      expect(body.data.pagination).toMatchObject({ total: 2, pageSize: 1 });
      expect(body.data.rows).toHaveLength(1);
      expect(body.data.rows[0]?.itemId).toBe('ITEM-2');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('passes exact matched Item IDs to the inventory source', async () => {
    let received: { itemIds?: string[] } | undefined;
    const app = express();
    app.use(brightDataRouter({
      visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set() }),
      inventory: async (_tenantId, filters) => { received = filters; return inventory.filter((row) => row.itemId === 'ITEM-1'); },
    }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/inventory?itemIds=ITEM-1`);
      expect(response.status).toBe(200);
      expect(received?.itemIds).toEqual(['ITEM-1']);
      expect((await response.json() as { data: { rows: BrightDataInventoryRow[] } }).data.rows).toHaveLength(1);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('searches catalog and returns only the matching Item ID inventory history', async () => {
    let received: { tenantId: string; query: string } | undefined;
    const app = express();
    app.use(brightDataRouter({
      visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set() }),
      search: async (tenantId, query) => {
        received = { tenantId, query };
        return { items: [items[0]!], inventory: [inventory[0]!] };
      },
    }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/search?q=Widget`);
      const body = await response.json() as { data: { items: BrightDataItemRow[]; inventory: BrightDataInventoryRow[] } };
      expect(response.status).toBe(200);
      expect(received).toEqual({ tenantId: 'tenant-1', query: 'Widget' });
      expect(body.data.items.map((row) => row.itemId)).toEqual(['ITEM-1']);
      expect(body.data.inventory.map((row) => row.itemId)).toEqual(['ITEM-1']);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('rejects unfiltered inventory requests instead of scanning all tenant history', async () => {
    let sourceCalled = false;
    const app = express();
    app.use(brightDataRouter({
      visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set() }),
      inventory: async () => { sourceCalled = true; return inventory; },
    }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/inventory`);
      expect(response.status).toBe(400);
      expect(sourceCalled).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('filters item names by Item ID and paginates for any authenticated role', async () => {
    const app = testApp();
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/items?itemId=ITEM-2`);
      const body = await response.json() as { data: { rows: BrightDataItemRow[]; pagination: { total: number } } };
      expect(response.status).toBe(200);
      expect(body.data.pagination.total).toBe(1);
      expect(body.data.rows.map((row) => row.itemId)).toEqual(['ITEM-2']);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('requires an authenticated tenant', async () => {
    const app = express();
    app.use(brightDataRouter({ visibility: () => undefined }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/brightdata/items`);
      expect(response.status).toBe(401);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
