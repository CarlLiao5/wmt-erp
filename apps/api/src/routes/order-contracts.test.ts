import express from 'express';
import { expect, it } from 'vitest';
import { ordersRouter } from './orders.js';
import { returnsRouter } from './returns.js';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/passwords.js';
import { createSyncRouter } from './sync.js';

const visibility = () => ({ tenantId: 't1', role: 'member' as const, storeIds: new Set<string>(), skus: new Set(['s1:A']), customerFields: new Set(['name']) });
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
  expect(detail.lines[0].customer).toBeUndefined();
  expect((await request(app, '/orders/export')).data.lines.map((line: { id: string }) => line.id)).toEqual(['l1']);
  expect((await request(app, '/metrics/sales')).data).toMatchObject({ orders: 1, units: 2, revenue: 12, refunds: 5, returnRate: 1 });
});

it('reveals allowed customer fields only within a store assignment', async () => {
  const app = express(); app.use(ordersRouter({ list: async () => lines, visibility: () => ({ tenantId: 't1', role: 'member', storeIds: new Set(['s1']), skus: new Set<string>(), customerFields: new Set(['name']) }) }));
  const detail = (await request(app, '/orders/o1')).data;
  expect(detail.lines[0].customer).toEqual({ name: 'Ada' });
  expect(detail.lines[0].customer.email).toBeUndefined();
});

it('filters returns by the same line scope', async () => {
  const app = express(); app.use(returnsRouter({ list: async () => returns, visibility, history: async () => [{ id: 'r1:REQUESTED', returnId: 'r1', status: 'REQUESTED', refundAmount: 0, returnedAt: '2026-01-02', rawResponseId: 'raw-1' }, { id: 'r2:REFUNDED', returnId: 'r2', status: 'REFUNDED', refundAmount: 7, returnedAt: '2026-01-03', rawResponseId: 'raw-2' }] }));
  expect((await request(app, '/returns')).data.rows.map((row: { id: string }) => row.id)).toEqual(['r1']);
  expect((await request(app, '/returns/r1/history')).data.map((row: { status: string }) => row.status)).toEqual(['REQUESTED']);
  expect((await request(app, '/returns/r2/history')).data).toBeNull();
});

it('names date basis and filters returns by order and item', async () => {
  const app = express(); app.use(returnsRouter({ list: async () => [{ ...returns[0], orderNumber: '100', itemId: 'i1' }], visibility }));
  const result = (await request(app, '/returns?orderNumber=100&itemId=i1&from=2026-01-03&to=2026-01-03')).data;
  expect(result).toMatchObject({ dateBasis: 'returnedAt', total: 1 });
  expect((await request(app, '/returns?orderNumber=other')).data.total).toBe(0);
});

it('derives queued sync tenant from authenticated scope and checks store access', async () => {
  const queued: unknown[] = [];
  const app = express(); app.use(express.json()); app.use(createSyncRouter(async (request) => { queued.push(request); return { id: 'j', jobId: 'j' }; }, visibility));
  const server = await new Promise<import('node:http').Server>((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'other', storeId: 's1', resource: 'orders', window: { from: '2026-01-01', to: '2026-01-02' } }) });
    expect(response.status).toBe(403);
    expect(queued).toEqual([]);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('uses filtered order-line cohort for refunds and return rate', async () => {
  const source = [
    { id: 'a', tenantId: 't1', orderId: 's1:100', orderNumber: '100', storeId: 's1', sku: 'A', quantity: 1, amount: 10, orderedAt: '2026-01-02', status: 'SHIPPED' },
    { id: 'b', tenantId: 't1', orderId: 's1:101', orderNumber: '101', storeId: 's1', sku: 'B', quantity: 1, amount: 20, orderedAt: '2026-01-03', status: 'NEW' },
    { id: 'c', tenantId: 't1', orderId: 's2:100', orderNumber: '100', storeId: 's2', sku: 'A', quantity: 1, amount: 30, orderedAt: '2026-01-02', status: 'SHIPPED' }
  ];
  const refunds = [
    { id: 'r-a', tenantId: 't1', orderId: 's1:100', storeId: 's1', sku: 'A', amount: 4, status: 'REFUNDED', returnedAt: '2026-02-01' },
    { id: 'r-b', tenantId: 't1', orderId: 's1:101', storeId: 's1', sku: 'B', amount: 7, status: 'REFUNDED', returnedAt: '2026-02-01' },
    { id: 'r-c', tenantId: 't1', orderId: 's2:100', storeId: 's2', sku: 'A', amount: 9, status: 'REFUNDED', returnedAt: '2026-02-01' }
  ];
  const app = express(); app.use(ordersRouter({ list: async () => source, returns: async () => refunds, visibility: () => ({ tenantId: 't1', role: 'member', storeIds: new Set(['s1']), skus: new Set<string>() }) }));
  expect((await request(app, '/metrics/sales?sku=A&status=SHIPPED&from=2026-01-02&to=2026-01-02')).data).toMatchObject({ orders: 1, revenue: 10, refunds: 4, returns: 1, returnRate: 1 });
  expect((await request(app, '/metrics/sales?orderNumber=101&status=SHIPPED')).data).toMatchObject({ orders: 0, refunds: 0, returns: 0, returnRate: 0 });
  expect((await request(app, '/orders/s1:100')).data.lines.map((line: { id: string }) => line.id)).toEqual(['a']);
  expect((await request(app, '/orders/100')).data).toBeNull();
});

it('uses the login session to authorize mounted read routes', async () => {
  const app = createApp({ commerce: { listOrders: async () => lines.slice(0, 2).map((line) => ({ ...line, tenantId: 'default' })), listReturns: async () => returns.map((row) => ({ ...row, tenantId: 'default' })) } });
  const server = await new Promise<import('node:http').Server>((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const orders = await fetch(`${base}/orders`, { headers: { cookie } });
    expect(orders.status).toBe(200);
    expect((await orders.json()).data.lines.map((line: { id: string }) => line.id)).toEqual(['l1', 'l2']);
    const returns = await fetch(`${base}/returns`, { headers: { cookie } });
    expect(returns.status).toBe(200);
    expect((await returns.json()).data.rows.map((row: { id: string }) => row.id)).toEqual(['r1', 'r2']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('loads member assignments from the authenticated user for mounted routes', async () => {
  const passwordHash = await hashPassword('member-pass');
  let requestedTenant: string | undefined;
  const app = createApp({
    commerce: { listOrders: async () => lines, listReturns: async () => returns },
    findUser: async (email, tenantId) => { requestedTenant = tenantId; return email === 'member@example.com' && tenantId === 't1' ? { id: 'member-1', tenantId: 't1', role: 'member', passwordHash } : undefined; },
    assignments: async () => [{ tenantId: 't1', userId: 'member-1', storeId: 's1', validFrom: new Date('2025-01-01') }]
  });
  const server = await new Promise<import('node:http').Server>((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 't1', email: 'member@example.com', password: 'member-pass' }) });
    expect(login.status).toBe(200);
    expect(requestedTenant).toBe('t1');
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const response = await fetch(`${base}/orders`, { headers: { cookie } });
    expect((await response.json()).data.lines.map((line: { id: string }) => line.id)).toEqual(['l1', 'l2']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
