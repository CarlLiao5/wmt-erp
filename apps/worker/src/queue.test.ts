import { describe, expect, it } from 'vitest'; import { processSyncRequest, syncJobId } from './queue.js';
describe('sync queue',()=>{ it('derives the same id for overlapping duplicate windows',()=>{ const input={tenantId:'t',storeId:'s',resource:'orders',window:{from:'2026-01-01',to:'2026-01-02'}}; expect(syncJobId(input)).toBe(syncJobId({...input})); }); });

it('dispatches queued commerce resources to persisted sync handlers', async () => {
  const called: string[] = [];
  const handlers = { orders: async () => { called.push('orders'); }, returns: async () => { called.push('returns'); } };
  const request = { tenantId: 't', storeId: 's', resource: 'orders', window: { from: '2026-01-01', to: '2026-01-02' } };
  await processSyncRequest(request, async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox', baseUrl: 'https://example.test' }), handlers);
  await processSyncRequest({ ...request, resource: 'returns' }, async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox', baseUrl: 'https://example.test' }), handlers);
  expect(called).toEqual(['orders', 'returns']);
  await expect(processSyncRequest({ ...request, resource: 'inventory' }, async () => { throw new Error('must not load credentials'); }, handlers)).rejects.toThrow('Unsupported commerce sync resource');
});
