import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/passwords.js';
import { authRouter } from './auth.js';
import { validateTargetRows } from './imports.js';
import { importsRouter } from './imports.js';

describe('target imports', () => {
  it('reports row validation errors before commit', () => {
    expect(validateTargetRows([{ month: '2026-10' }])).toEqual(['row 1 missing month or target']);
  });
});

const previousMysqlUrl = process.env.MYSQL_URL;
afterEach(() => { if (previousMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = previousMysqlUrl; });

describe('Targets member SKU visibility', () => {
  it('summarizes only owned SKU sales and denies store-target import records', async () => {
    delete process.env.MYSQL_URL;
    const passwordHash = await hashPassword('member-pass');
    const app = express(); app.use(express.json());
    app.use(authRouter(async () => ({ id: 'member-1', tenantId: 't1', role: 'member', passwordHash })));
    app.use(importsRouter({
      visibility: () => ({ tenantId: 't1', role: 'member', storeIds: new Set<string>(), skus: new Set(['store-a:SKU-1']) }),
      orders: async () => [
        { tenantId: 't1', orderId: 'o1', storeId: 'store-a', sku: 'SKU-1', quantity: 1, amount: 12, orderedAt: '2026-10-02T12:00:00Z' },
        { tenantId: 't1', orderId: 'o2', storeId: 'store-a', sku: 'SKU-2', quantity: 1, amount: 800, orderedAt: '2026-10-02T12:00:00Z' },
        { tenantId: 't1', orderId: 'o3', storeId: 'store-b', sku: 'SKU-1', quantity: 1, amount: 900, orderedAt: '2026-10-02T12:00:00Z' },
        { tenantId: 't2', orderId: 'o4', storeId: 'store-a', sku: 'SKU-1', quantity: 1, amount: 1000, orderedAt: '2026-10-02T12:00:00Z' },
      ],
    }));
    const server = await new Promise<import('node:http').Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
      const base = `http://127.0.0.1:${address.port}`;
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 't1', email: 'member@example.com', password: 'member-pass' }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const summary = await fetch(`${base}/targets/summary?month=2026-10`, { headers: { cookie } }).then((response) => response.json());
      expect(summary.data).toMatchObject({ target: null, completedSales: 12, completionRate: null, targetAvailable: false, targetUnavailableReason: 'store_target_not_allocatable' });
      expect((await fetch(`${base}/imports/targets`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ month: '2026-10', target: 100 }] }) })).status).toBe(403);
      expect((await fetch(`${base}/imports/private-batch`, { headers: { cookie } })).status).toBe(403);
      expect((await fetch(`${base}/imports/private-batch/export`, { headers: { cookie } })).status).toBe(403);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
