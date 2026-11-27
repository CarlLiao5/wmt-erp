import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inventoryAge, inventoryLogPagination, inventorySnapshotRecord, mysqlRows, reconcileInventory } from './inventory.js';
import express from 'express';
import { authRouter } from './auth.js';
import { inventoryRouter } from './inventory.js';

const previousMysqlUrl = process.env.MYSQL_URL;
beforeEach(() => { delete process.env.MYSQL_URL; });
afterEach(() => { if (previousMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = previousMysqlUrl; });
it('calculates age and reconciliation delta', () => { expect(inventoryAge('2026-01-01', new Date('2026-01-03'))).toBe(2); expect(reconcileInventory([{ storeId: 's', sku: 'x', quantity: 5, updatedAt: '' }], [{ storeId: 's', sku: 'x', quantity: 3, updatedAt: '' }])[0].delta).toBe(-2); });

it('reads mysql2 query rows from the result tuple before filtering inventory snapshots', () => {
  const rows = [{ storeId: 'store-a', sku: 'SKU-1' }];
  expect(mysqlRows([rows, []])).toBe(rows);
});

it('paginates inventory logs with a 50-row default and a 100-row maximum', () => {
  expect(inventoryLogPagination({})).toEqual({ page: 1, pageSize: 50, offset: 0 });
  expect(inventoryLogPagination({ page: '3', pageSize: '25' })).toEqual({ page: 3, pageSize: 25, offset: 50 });
  expect(inventoryLogPagination({ page: '-1', pageSize: '500' })).toEqual({ page: 1, pageSize: 100, offset: 0 });
});

describe('inventory filters', () => {
  it('filters by node and risk', async () => { const { filterInventory } = await import('./inventory.js'); const rows = filterInventory([{ storeId: 's', sku: 'a', nodeId: 'FC-1', quantity: 0, updatedAt: '2026-10-05T00:00:00Z', risk: 'stockout' }, { storeId: 's', sku: 'b', nodeId: 'FC-2', quantity: 4, updatedAt: '2026-10-05T00:00:00Z', risk: 'normal' }], { nodeId: 'FC-1', risk: 'stockout' }); expect(rows).toHaveLength(1); expect(rows[0].sku).toBe('a'); });
});

it('normalizes inventory SKU keys and ignores missing SKU values', async () => {
  const { inventorySkuKey } = await import('./inventory.js');
  expect(inventorySkuKey('store-a', ' sku-1 ')).toBe('store-a:SKU-1');
  expect(inventorySkuKey('store-a', undefined)).toBeUndefined();
  expect(inventorySkuKey('store-a', '   ')).toBeUndefined();
});

describe('Recon storage fee billing period', () => {
  it('returns the earliest start and latest end dates from WFS StorageFee rows only', async () => {
    const { storageFeePeriod } = await import('./inventory.js');
    const rows = storageFeePeriod([
      { description: 'WFS StorageFee', periodStartDate: new Date('2026-09-26T00:00:00Z'), periodEndDate: new Date('2026-10-02T00:00:00Z') },
      { description: 'WFS StorageFee', periodStartDate: new Date('2026-09-19T00:00:00Z'), periodEndDate: new Date('2026-09-25T00:00:00Z') },
      { description: 'WFS FulfillmentFee', periodStartDate: new Date('2026-10-01T00:00:00Z'), periodEndDate: new Date('2026-10-03T00:00:00Z') },
    ], '2026-10');
    expect(rows).toEqual({ startDate: '2026-09-26', endDate: '2026-10-02' });
  });

  it('returns no period when there are no WFS StorageFee rows', async () => {
    const { storageFeePeriod } = await import('./inventory.js');
    expect(storageFeePeriod([{ 'Transaction Description': 'WFS FulfillmentFee', 'Period Start Date': '10/01/2026', 'Period End Date': '10/03/2026' }])).toEqual({ startDate: null, endDate: null });
  });
});

describe('WFS reconciliation interval', () => { it('requires one hour between runs', async () => { const { enforceReconciliationInterval } = await import('./wfs.js'); const now = new Date('2026-10-05T02:00:00Z'); expect(enforceReconciliationInterval(new Date('2026-10-05T01:30:00Z'), now)).toBe(false); expect(enforceReconciliationInterval(new Date('2026-10-05T01:00:00Z'), now)).toBe(true); }); });

describe('inventory text filters', () => { it('matches SKU and product name case-insensitively', async () => { const { filterInventory } = await import('./inventory.js'); const rows = filterInventory([{ storeId:'s', sku:'ABC-1', productName:'Portable Fan', nodeId:'WFS', quantity:1, updatedAt:'2026-10-05T00:00:00Z' }], { sku:'abc', productName:'fan' }); expect(rows).toHaveLength(1); }); });
it('matches inventory by its ALLSKU Chinese name', async () => { const { filterInventory } = await import('./inventory.js'); const rows = filterInventory([{ storeId:'s', sku:'ABC-1', chineseName:'苹果削皮器', quantity:1, updatedAt:'2026-10-05T00:00:00Z' }], { productName:'削皮' }); expect(rows).toHaveLength(1); });

describe('inventory snapshot selection', () => {
  it('uses only the newest sync snapshot for each store', async () => {
    const { latestInventoryPayloads } = await import('./inventory.js');
    const rows = [
      { storeId:'s', receivedAt:new Date('2026-10-05T11:00:00Z'), payload:{sku:'x'} },
      { storeId:'s', receivedAt:new Date('2026-10-05T14:00:00Z'), payload:{sku:'x'} },
      { storeId:'s', receivedAt:new Date('2026-10-05T14:00:00Z'), payload:{sku:'y'} },
      { storeId:'other', receivedAt:new Date('2026-10-05T10:00:00Z'), payload:{sku:'z'} },
    ];
    expect(latestInventoryPayloads(rows).map(x => x.payload.sku)).toEqual(['x','y','z']);
  });

  it('projects normalized inventory snapshots with health metadata without changing quantities', () => {
    expect(inventorySnapshotRecord(
      { storeId: 'store-a', sku: 'SKU-1', nodeId: 'FC-1', quantity: '12', occurredAt: new Date('2026-11-03T12:00:00Z') },
      { productName: 'Fan', firstInStockDate: '2026-10-01', ageDistribution: { '0To90days': 12 }, reservedQuantity: 2 },
      { chineseName: '风扇', imageUrl: 'https://example.test/fan.jpg' },
    )).toEqual({ storeId: 'store-a', sku: 'SKU-1', nodeId: 'FC-1', quantity: 12, productName: 'Fan', firstInStockDate: '2026-10-01', ageDistribution: { '0To90days': 12 }, reservedQuantity: 2, chineseName: '风扇', imageUrl: 'https://example.test/fan.jpg', updatedAt: '2026-11-03T12:00:00.000Z', risk: 'normal' });
  });
});

describe('inventory member SKU visibility', () => {
  it('filters inventory, SKU logs and store-level fees to the member scope', async () => {
    const visible = { tenantId: 't1', role: 'member' as const, storeIds: new Set<string>(), skus: new Set(['store-a:SKU-1']) };
    const app = express();
    app.use(express.json());
    app.use(authRouter());
    app.use(inventoryRouter(async () => [
      { storeId: 'store-a', sku: 'SKU-1', quantity: 5, updatedAt: '2026-10-10T00:00:00Z' },
      { storeId: 'store-a', sku: 'SKU-2', quantity: 9, updatedAt: '2026-10-10T00:00:00Z' },
      { storeId: 'store-b', sku: 'SKU-1', quantity: 12, updatedAt: '2026-10-10T00:00:00Z' },
    ], async () => [], () => visible));
    const server = await new Promise<import('node:http').Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
      const base = `http://127.0.0.1:${address.port}`;
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const inventory = await fetch(`${base}/inventory`, { headers: { cookie } });
      expect((await inventory.json()).data.rows.map((row: { sku: string; storeId: string }) => `${row.storeId}:${row.sku}`)).toEqual(['store-a:SKU-1']);
      const logs = await fetch(`${base}/inventory/SKU-2/logs?storeId=store-a`, { headers: { cookie } });
      expect(logs.status).toBe(404);
      expect((await logs.json()).data).toBeNull();
      const fees = await fetch(`${base}/inventory/storage-fees?month=2026-10`, { headers: { cookie } });
      expect((await fees.json()).data).toMatchObject({ amount: null, currency: null, rows: [], period: { startDate: null, endDate: null } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
