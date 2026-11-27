import { expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import { createApp } from '../../api/src/app.js';
import { projectCommerceRows, type RawCommerceRow } from '../../api/src/routes/commerce-source.js';
import { defaultSyncQueueName, enqueueSync, processSyncRequest, reportsSyncQueueName, syncQueueNameForResource, type SyncRequest } from './queue.js';

it('routes asynchronous Walmart reports to their dedicated queue', () => {
  expect(reportsSyncQueueName).toBe('walmart-sync-reports');
  for (const resource of ['storage-fees', 'advertising-sem-performance', 'advertising-sem-search-terms', 'item-report']) {
    expect(syncQueueNameForResource(resource)).toBe(reportsSyncQueueName);
  }
  expect(syncQueueNameForResource('orders')).toBe(defaultSyncQueueName);
});

it('serves raw commerce pages after queued dispatch through the mounted API', async () => {
  const pending: SyncRequest[] = [];
  const queue = { add: async (_name: string, request: SyncRequest) => { pending.push(request); return { id: 'job-1' }; } } as unknown as Queue<SyncRequest>;
  const request: SyncRequest = { tenantId: 'default', storeId: 's', resource: 'orders', window: { from: '2026-01-01', to: '2026-01-02' } };
  await enqueueSync(request, queue);
  const raw: RawCommerceRow[] = [];
  const handlers = {
    orders: async (window: { tenantId: string; storeId: string }) => { raw.push({ id: '1', tenantId: window.tenantId, storeId: window.storeId, resource: 'orders', payload: { orders: [{ purchaseOrderId: 'o1', orderDate: '2026-01-01', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' }, orderLineQuantity: { amount: 1 }, amount: 10 }] } }] } }); },
    returns: async () => {}
  };
  await processSyncRequest(pending[0], async () => ({ clientId: 'fixture', clientSecret: 'fixture', environment: 'sandbox', baseUrl: 'https://example.test' }), handlers);
  const app = createApp({ commerce: { listOrders: async () => projectCommerceRows(raw).orders, listReturns: async () => [] } });
  const server = await new Promise<import('node:http').Server>((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const response = await fetch(`${base}/orders`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect((await response.json()).data.lines).toMatchObject([{ orderId: 's:o1', sku: 'A', amount: 10 }]);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
