import { describe, expect, it } from 'vitest'; import { completedSyncJobUpdate, processSyncRequest, syncErrorMessage, syncJobId, syncJobScope, syncWorkerConcurrency } from './queue.js';
describe('sync queue',()=>{ it('derives the same id when an explicit batch is reused',()=>{ const input={tenantId:'t',storeId:'s',resource:'orders',batchId:'batch-1',window:{from:'2026-01-01',to:'2026-01-02'}}; expect(syncJobId(input)).toBe(syncJobId({...input})); }); it('derives different ids for automatic batches',()=>{ const input={tenantId:'t',storeId:'s',resource:'orders',window:{from:'2026-01-01',to:'2026-01-02'}}; expect(syncJobId(input)).not.toBe(syncJobId(input)); }); });

it('scopes sync job updates by store and idempotency key to use the composite index', () => {
  const request = { tenantId: 't', storeId: 'store-7', resource: 'orders', batchId: 'batch-1', window: { from: '2026-01-01', to: '2026-01-02' } };
  expect(syncJobScope(request)).toEqual({ storeId: 'store-7', idempotencyKey: syncJobId(request) });
});

it('allows multiple independent sync jobs to progress while endpoint rate limits remain in the request layer', () => {
  expect(syncWorkerConcurrency).toBe(4);
});

it('records the actual completion timestamp on successful sync jobs', () => {
  const completedAt = new Date('2026-10-15T04:05:06.789Z');
  expect(completedSyncJobUpdate(completedAt)).toEqual({ status: 'completed', completedAt });
});

it('reports the underlying database error without exposing SQL parameters', () => {
  const cause = Object.assign(new Error('Duplicate entry customer@example.com for key orders_store_external_unique'), { code: 'ER_DUP_ENTRY' });
  const queryError = Object.assign(new Error('Failed query: INSERT INTO orders VALUES (?)\nparams: customer@example.com'), { cause });

  expect(syncErrorMessage(queryError)).toBe('ER_DUP_ENTRY: database rejected a duplicate key');
  expect(syncErrorMessage(queryError)).not.toContain('customer@example.com');
  expect(syncErrorMessage(queryError)).not.toContain('INSERT INTO');
});

it('dispatches tenant-level head freight without loading a Walmart store connection', async () => {
  let called = false; let loaded = false;
  await processSyncRequest({ tenantId: 't', storeId: '__tenant__', resource: 'head-freight', window: { from: '2026-01-01', to: '2026-01-02' }, batchId: 'batch' }, async () => { loaded = true; throw new Error('must not load Walmart connection'); }, { orders: async () => undefined, returns: async () => undefined, headFreight: async (window) => { called = window.batchId === 'batch'; } });
  expect(called).toBe(true); expect(loaded).toBe(false);
});

it('dispatches ALLSKU2026 as a tenant-level SmartSheet job without loading a Walmart store connection', async () => {
  let called = false; let loaded = false;
  await processSyncRequest({ tenantId: 't', storeId: '__tenant__', resource: 'smart-sheet-allsku2026', window: { from: '2026-01-01', to: '2026-01-02' }, batchId: 'batch' }, async () => { loaded = true; throw new Error('must not load Walmart connection'); }, { orders: async () => undefined, returns: async () => undefined, allSku: async (window) => { called = window.batchId === 'batch'; } });
  expect(called).toBe(true); expect(loaded).toBe(false);
});

it('dispatches freight tracking as a tenant-level job without loading Walmart credentials', async () => {
  let received: any;
  let loaded = false;
  await processSyncRequest({ tenantId: 't', storeId: '__tenant__', resource: 'freight-tracking', window: { from: '2026-01-01', to: '2026-01-02' }, batchId: 'batch' }, async () => { loaded = true; throw new Error('must not load Walmart connection'); }, {
    orders: async () => undefined,
    returns: async () => undefined,
    freightTracking: async (window) => { received = window; return { written: 0 }; },
  });
  expect(loaded).toBe(false);
  expect(received).toMatchObject({ tenantId: 't', batchId: 'batch' });
});

it('dispatches queued commerce resources to persisted sync handlers', async () => {
  const called: string[] = [];
  const handlers = { orders: async () => { called.push('orders'); }, returns: async () => { called.push('returns'); } };
  const request = { tenantId: 't', storeId: 's', resource: 'orders', window: { from: '2026-01-01', to: '2026-01-02' } };
  await processSyncRequest(request, async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox', baseUrl: 'https://example.test' }), handlers);
  await processSyncRequest({ ...request, resource: 'returns' }, async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox', baseUrl: 'https://example.test' }), handlers);
  expect(called).toEqual(['orders', 'returns']);
  const inventory = { ...handlers, inventory: async () => { called.push('inventory'); } };
  await processSyncRequest({ ...request, resource: 'inventory' }, async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox', baseUrl: 'https://example.test' }), inventory);
  expect(called).toEqual(['orders', 'returns', 'inventory']);
});

it('dispatchesWfsInboundPreviewWithStoreConnection', async () => {
  const received: unknown[] = [];
  const connection = { clientId: 'id', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.test' };
  const request = { tenantId: 'tenant', storeId: 'store-1', resource: 'wfs-inbound-preview', window: { from: '2026-10-01', to: '2026-10-31' } };
  await processSyncRequest(request, async (input) => { received.push(input.storeId); return connection; }, {
    orders: async () => undefined,
    returns: async () => undefined,
    inventory: async () => { received.push('inventory'); },
    wfsFeePreview: async (window, loadedConnection) => { received.push(window, loadedConnection); return { scanned: 1, previewed: 1 }; },
  });
  expect(received).toEqual(['store-1', { tenantId: 'tenant', storeId: 'store-1', from: '2026-10-01', to: '2026-10-31' }, connection]);
});

it.each(['incremental','initial','full'] as const)('passes explicit %s shipment mode to the shared inventory handler',async(mode)=>{
 let actual:any;await processSyncRequest({tenantId:'t',storeId:'s',resource:'inventory',window:{from:'2026-01-01',to:'2026-02-01'},state:{shipmentMode:mode}},async()=>({} as any),{orders:async()=>{},returns:async()=>{},inventory:async(window)=>{actual=window;return {};}});
 expect(actual.shipmentMode).toBe(mode);
});
