import express from 'express';
import { expect, it } from 'vitest';
import { ordersRouter } from './orders.js';
import { returnsRouter } from './returns.js';
import { createApp } from '../app.js';

const visibility = () => ({ tenantId: 't1', role: 'member' as const, storeIds: new Set<string>(), skus: new Set(['A']), customerFields: new Set(['name']) });
const lines = [
  { id: 'l1', tenantId: 't1', orderId: 'o1', storeId: 's1', sku: 'A', itemId: 'i1', quantity: 2, amount: 12, orderedAt: '2026-01-02T11:00:00Z', status: 'SHIPPED', orderNumber: '100', customer: { name: 'Ada', email: 'ada@example.com' } },
  { id: 'l2', tenantId: 't1', orderId: 'o1', storeId: 's1', sku: 'B', quantity: 1, amount: 7, orderedAt: '2026-01-02', status: 'SHIPPED', orderNumber: '100', customer: { name: 'Ada', email: 'ada@example.com' } },
  { id: 'l3', tenantId: 't2', orderId: 'o2', storeId: 's2', sku: 'A', quantity: 9, amount: 90, orderedAt: '2026-01-02', status: 'NEW', orderNumber: '200' }
];
const returns = [{ id: 'r1', tenantId: 't1', orderId: 'o1', storeId: 's1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-03' }, { id: 'r2', tenantId: 't1', orderId: 'o1', storeId: 's1', sku: 'B', amount: 7, status: 'REFUNDED', returnedAt: '2026-01-03' }];

async function request(app: express.Express, path: string) {
  const server = await new Promise<import('node:http').Server>((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try { const address = server.address(); if (!address || typeof address === 'string') throw new Error('address'); return await (await fetch(`http://127.0.0.1:${address.port}${path}`)).json() as { data: any }; }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

it('filters list, detail, export and metrics to visible tenant and SKU lines', async () => {
  const app = express(); app.use(ordersRouter({ list: async () => lines, visibility, returns: async () => returns }));
  expect((await request(app, '/orders?sku=A&status=SHIPPED&page=1&pageSize=10')).data.lines.map((line: { id: string }) => line.id)).toEqual(['l1']);
  expect((await request(app, '/orders?from=2026-01-02&to=2026-01-02')).data.lines.map((line: { id: string }) => line.id)).toEqual(['l1']);
  const detail = (await request(app, '/orders/o1')).data;
  expect(detail.lines.map((line: { id: string }) => line.id)).toEqual(['l1']);
  expect(detail.lines[0].customer).toEqual({ name: 'Ada' });
  expect((await request(app, '/orders/export')).data.lines.map((line: { id: string }) => line.id)).toEqual(['l1']);
  expect((await request(app, '/metrics/sales')).data).toMatchObject({ orders: 1, units: 2, revenue: 12, refunds: 5, returnRate: 1 });
});

it('filters returns by the same line scope', async () => {
  const app = express(); app.use(returnsRouter({ list: async () => returns, visibility }));
  expect((await request(app, '/returns')).data.rows.map((row: { id: string }) => row.id)).toEqual(['r1']);
});

it('uses the login session to authorize mounted read routes', async () => {
  const app = createApp();
  const server = await new Promise<import('node:http').Server>((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect((await fetch(`${base}/orders`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${base}/returns`, { headers: { cookie } })).status).toBe(200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
