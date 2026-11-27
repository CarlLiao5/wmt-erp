import express from 'express';
import { expect, it } from 'vitest';
import { ordersRouter } from './orders.js';
import { returnsRouter } from './returns.js';
import { returnRateOrderDateRange, todayPacificDate } from './commerce-source.js';
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
  expect((await request(app, '/metrics/sales')).data).toMatchObject({ orders: 1, units: 2, revenue: 12, refunds: 5, returnRate: 5 / 12 });
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

it('uses the selected Pacific date range for the return-rate denominator', async () => {
  let orderQuery: unknown;
  const app = express(); app.use(returnsRouter({
    list: async () => [returns[0]],
    orders: async (_tenantId, query) => { orderQuery = query; return []; },
    visibility,
  }));
  const today = todayPacificDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  await request(app, `/returns?from=${monthStart}&to=2999-12-31`);
  expect(orderQuery).toMatchObject({ from: monthStart, to: today });
  await request(app, `/returns?from=${today}&to=${today}`);
  expect(orderQuery).toMatchObject({ from: today, to: today });
});

it('counts only seller-attributed returns in the reason chart and monthly return rate', async () => {
  const today = todayPacificDate();
  const sellerReturn = { id: 'seller-return', tenantId: 't1', orderId: 'seller-order', storeId: 's1', sku: 'A', amount: 5, status: 'REFUNDED', reason: 'Seller damage', refundCoveredBy: 'Seller', returnedAt: `${today}T12:00:00.000Z` };
  const walmartReturn = { id: 'walmart-return', tenantId: 't1', orderId: 'walmart-order', storeId: 's1', sku: 'A', amount: 9, status: 'REFUNDED', reason: 'Carrier damage', refundCoveredBy: 'Walmart', returnedAt: `${today}T12:00:00.000Z` };
  const walmartKeepItReturn = { ...walmartReturn, id: 'walmart-keep-it', orderId: 'walmart-keep-it-order', refundCoveredBy: 'Walmart Keep-It' };
  const replacementReturn = { ...walmartReturn, id: 'replacement-return', orderId: 'replacement-order', refundCoveredBy: 'Replacement' };
  const app = express(); app.use(returnsRouter({
    list: async () => [sellerReturn, walmartReturn, walmartKeepItReturn, replacementReturn],
    orders: async () => [
      { id: 'order-1', tenantId: 't1', orderId: 'seller-order', storeId: 's1', sku: 'A', quantity: 1, amount: 10, orderedAt: `${today}T12:00:00.000Z`, status: 'SHIPPED' },
      { id: 'order-2', tenantId: 't1', orderId: 'walmart-order', storeId: 's1', sku: 'A', quantity: 1, amount: 10, orderedAt: `${today}T12:00:00.000Z`, status: 'SHIPPED' },
    ],
    visibility: () => ({ tenantId: 't1', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() }),
  }));
  const analytics = (await request(app, `/returns?from=${today}&to=${today}`)).data.analytics;
  expect(analytics.reasonDistribution).toEqual([{ reason: 'Seller damage', count: 1 }]);
  expect(analytics.returnedOrderCount).toBe(1);
  expect(analytics.orderedOrderCount).toBe(2);
  expect(analytics.monthReturnRate).toBe(0.5);
  expect(analytics.responsibilityDistribution).toEqual([
    { responsibility: '卖家责任', count: 1 },
    { responsibility: 'WFS责任', count: 2 },
    { responsibility: '其他/未提供', count: 1 },
  ]);
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
  expect((await request(app, '/metrics/sales?sku=A&status=SHIPPED&from=2026-01-02&to=2026-01-02')).data).toMatchObject({ orders: 1, revenue: 10, refunds: 4, returns: 1, returnRate: 0.4 });
  expect((await request(app, '/metrics/sales?orderNumber=101&status=SHIPPED')).data).toMatchObject({ orders: 0, refunds: 0, returns: 0, returnRate: 0 });
  expect((await request(app, '/orders/s1:100')).data.lines.map((line: { id: string }) => line.id)).toEqual(['a']);
  expect((await request(app, '/orders/100')).data).toBeNull();
});

it('uses database-paged results and aggregated charts when the optimized source is available', async () => {
  let requested: unknown;
  const app = express(); app.use(ordersRouter({
    list: async () => { throw new Error('legacy full-list source should not run'); },
    listPage: async (_tenantId, query) => { requested = query; return { rows: [lines[0]], total: 41, metrics: { orders: 32, units: 50, revenue: 420 }, dailyOrderTrend: [{ date: '2026-01-02', count: 12 }], hourlyOrderTrend: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 4 ? 12 : 0 })), chinaHourlyOrderTrend: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 20 ? 12 : 0 })), regionDistribution: [{ region: 'CA', count: 12 }], salesBySku: [{ storeId: 's1', sku: 'A', itemId: 'i1', units: 50, orders: 32, revenue: 420 }] }; },
    visibility: () => ({ tenantId: 't1', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() }),
  }));
  const result = (await request(app, '/orders?page=2&pageSize=20&from=2026-01-01&to=2026-01-31&sku=A&status=SHIPPED&view=sales')).data;
  expect(requested).toMatchObject({ page: 2, pageSize: 20, from: '2026-01-01', to: '2026-01-31', sku: 'A', status: 'SHIPPED', salesView: true });
  expect(result).toMatchObject({ total: 41, page: 2, pageSize: 20, metrics: { orders: 32, units: 50, revenue: 420 }, regionDistribution: [{ region: 'CA', count: 12 }], salesBySku: [{ sku: 'A', itemId: 'i1', units: 50, orders: 32, revenue: 420 }] });
  expect(result.lines).toHaveLength(1);
});

it('enriches sales rows with store-scoped product images and Chinese names', async () => {
  let imageProducts: unknown;
  let nameProducts: unknown;
  const app = express(); app.use(ordersRouter({
    list: async () => [],
    listPage: async () => ({ rows: [], total: 1, metrics: { orders: 1, units: 2, revenue: 12 }, dailyOrderTrend: [], hourlyOrderTrend: [], chinaHourlyOrderTrend: [], regionDistribution: [], salesBySku: [{ storeId: 's1', sku: 'A', itemId: 'i1', units: 2, orders: 1, revenue: 12 }] }),
    visibility: () => ({ tenantId: 't1', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() }),
    productImages: async (_tenantId, products) => { imageProducts = products; return new Map([['s1:A', 'https://img.example/a.jpg']]); },
    productChineseNames: async (_tenantId, products) => { nameProducts = products; return new Map([['s1:A', '中文商品名']]); },
  }));
  const result = (await request(app, '/orders?view=sales')).data;
  expect(imageProducts).toEqual([{ storeId: 's1', sku: 'A' }]);
  expect(nameProducts).toEqual([{ storeId: 's1', sku: 'A' }]);
  expect(result.salesBySku).toEqual([{ storeId: 's1', sku: 'A', itemId: 'i1', units: 2, orders: 1, revenue: 12, imageUrl: 'https://img.example/a.jpg', chineseName: '中文商品名' }]);
});

it('uses a scoped order-detail source instead of loading every order line', async () => {
  let requested: unknown;
  const app = express(); app.use(ordersRouter({
    list: async () => { throw new Error('order detail must not load the full tenant list'); },
    getOrderLines: async (_tenantId, orderId, scope) => { requested = { orderId, scope }; return [lines[0]]; },
    visibility,
  }));
  const result = (await request(app, '/orders/o1')).data;
  expect(requested).toMatchObject({ orderId: 'o1', scope: { storeIds: [], skuScopes: [{ storeId: 's1', sku: 'A' }] } });
  expect(result.lines.map((line: { id: string }) => line.id)).toEqual(['l1']);
});

it('uses Pacific calendar dates for return analytics and intersects the order denominator with the selected range', () => {
  expect(todayPacificDate(new Date('2026-11-04T06:30:00.000Z'))).toBe('2026-11-03');
  expect(returnRateOrderDateRange({ from: '2026-10-15', to: '2026-11-20' }, '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-03' });
  expect(returnRateOrderDateRange({ from: '2026-10-15', to: '2026-10-31' }, '2026-11-03')).toBeNull();
});

it('uses database pagination for members and pushes their store and SKU scope into the query', async () => {
  let requested: unknown;
  const app = express(); app.use(ordersRouter({
    list: async () => { throw new Error('full-list source should not run'); },
    listPage: async (_tenantId, query) => { requested = query; return { rows: [lines[0]], total: 1, metrics: { orders: 1, units: 2, revenue: 12 }, dailyOrderTrend: [], hourlyOrderTrend: [], chinaHourlyOrderTrend: [], regionDistribution: [] }; },
    visibility: () => ({ tenantId: 't1', role: 'member', storeIds: new Set(['s1', 's2']), skus: new Set(['s3:C']), }),
  }));
  const result = (await request(app, '/orders?page=1&pageSize=10')).data;
  expect(requested).toMatchObject({ storeIds: ['s1', 's2'], skuScopes: [{ storeId: 's3', sku: 'C' }] });
  expect(result.total).toBe(1);
});

it('uses optimized database pagination and aggregates for returns when available', async () => {
  let requested: unknown;
  const app = express(); app.use(returnsRouter({
    list: async () => { throw new Error('full-list source should not run'); },
    listPage: async (_tenantId, query) => { requested = query; return { rows: [returns[0]], total: 12, analytics: { todayNew: 1, monthReturnRate: null, returnedOrderCount: 0, orderedOrderCount: 0, monthRefundAmount: 0, reasonDistribution: [], responsibilityDistribution: [], dailyTrend: [], topProducts: [] } }; },
    visibility,
  }));
  const result = (await request(app, '/returns?page=2&pageSize=5&sku=A&reason=damaged')).data;
  expect(requested).toMatchObject({ page: 2, pageSize: 5, sku: 'A', reason: 'damaged', skuScopes: [{ storeId: 's1', sku: 'A' }] });
  expect(result).toMatchObject({ total: 12, page: 2, pageSize: 5, analytics: { todayNew: 1 } });
});

it('authorizes return history through the scoped SQL source and requests events only for that return', async () => {
  let pageQuery: unknown; let historyQuery: unknown;
  const app = express(); app.use(returnsRouter({
    list: async () => { throw new Error('full-list source should not run'); },
    listPage: async (_tenantId, query) => { pageQuery = query; return { rows: [{ ...returns[0], sku: 'A' }], total: 1, analytics: { todayNew: 0, monthReturnRate: null, returnedOrderCount: 0, orderedOrderCount: 0, monthRefundAmount: 0, reasonDistribution: [], responsibilityDistribution: [], dailyTrend: [], topProducts: [] } }; },
    history: async (_tenantId, query) => { historyQuery = query; return [{ id: 'event-1', returnId: 'r1', status: 'REQUESTED', refundAmount: 0, returnedAt: '2026-01-02', rawResponseId: 'raw-1' }]; },
    visibility,
  }));
  expect((await request(app, '/returns/r1/history')).data).toHaveLength(1);
  expect(pageQuery).toMatchObject({ returnId: 'r1', storeIds: [], skuScopes: [{ storeId: 's1', sku: 'A' }] });
  expect(historyQuery).toMatchObject({ returnId: 'r1', storeId: 's1', storeIds: [] });
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

it('exposes a paginated seller-only product return-rate view with tenant and SKU permissions', async () => {
  const app = express();
  const calls: any[] = [];
  app.use(returnsRouter({
    list: async () => [],
    listPage: async (tenantId, query) => { calls.push([tenantId, query]); return { rows: [], productRates: [{ sku: 'A', storeId: 's1', orderCount: 8, returnedOrderCount: 2, returnRate: 0.25, productName: 'Alpha' }], total: 23, analytics: {} as any } as any; },
    productImages: async () => new Map([['s1:A', 'https://img.example/a.jpg']]),
    productChineseNames: async () => new Map([['s1:A', '中文商品名']]),
    visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(['s1']), skus: new Set(['s2:B']), customerFields: new Set() }),
  }));
  const result = (await request(app, '/returns?view=product-rates&from=2026-11-01&to=2026-11-10&page=2&pageSize=10&sort=returnRate&direction=desc')).data;
  expect(result.productRates).toEqual([{ sku: 'A', storeId: 's1', orderCount: 8, returnedOrderCount: 2, returnRate: 0.25, productName: 'Alpha', imageUrl: 'https://img.example/a.jpg', chineseName: '中文商品名' }]);
  expect(result.total).toBe(23);
  expect(result.analytics).toBeUndefined();
  expect(calls[0]).toMatchObject(['tenant-1', { page: 2, pageSize: 10, from: '2026-11-01', to: '2026-11-10', productRates: true, sort: 'returnRate', direction: 'desc', storeIds: ['s1'], skuScopes: [{ storeId: 's2', sku: 'B' }] }]);
});
