import express from 'express';
import { describe, expect, it } from 'vitest';
import { syncPlansRouter, type SyncPlanStore } from './sync-plans.js';

function makeApp(store: SyncPlanStore, session: any) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
  app.use(syncPlansRouter({ store, session: async () => session }));
  return app;
}

describe('sync plans routes', () => {
  it('creates resource plans in the authenticated tenant', async () => {
    let input: any;
    const store: SyncPlanStore = {
      create: async (value) => { input = value; return value.resources.map((resource) => ({ id: 'plan-1', resource, mode: value.mode })); },
      get: async () => undefined,
    };
    const app = makeApp(store, { tenantId: 'tenant-1', userId: 'admin', role: 'admin' });
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resources: ['orders', 'returns'], mode: 'initial' }) });
      expect(response.status).toBe(202);
      expect(input).toMatchObject({ tenantId: 'tenant-1', storeId: 'store-1', resources: ['orders', 'returns'], mode: 'initial' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('rejects a member plan for an unassigned store', async () => {
    const store: SyncPlanStore = { create: async () => [], get: async () => undefined };
    const app = makeApp(store, { tenantId: 'tenant-1', userId: 'member', role: 'member', storeIds: new Set(['store-2']) });
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resources: ['orders'], mode: 'initial' }) });
      expect(response.status).toBe(403);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('rejects tenant-only incremental resources in a store-scoped plan', async () => {
    let created = false;
    const store: SyncPlanStore = { create: async () => { created = true; return []; }, get: async () => undefined };
    const app = makeApp(store, { tenantId: 'tenant-1', userId: 'admin', role: 'admin' });
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resources: ['lingxing-advertising', 'weather'], mode: 'incremental' }) });
      expect(response.status).toBe(400);
      expect(created).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('returns resource coverage and boundary evidence', async () => {
    const store: SyncPlanStore = { create: async () => [], get: async () => ({ id: 'plan-1', status: 'partial', resources: [{ resource: 'orders', coverageFrom: '2026-04-19', coverageTo: '2026-10-16', boundaryReason: 'orders_api_180_day_limit', windowCount: 6, completedWindows: 6, failedWindows: 0 }] }) };
    const app = makeApp(store, { tenantId: 'tenant-1', userId: 'admin', role: 'admin' });
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync/plans/plan-1`);
      expect(response.status).toBe(200);
      expect((await response.json()).data.resources[0].boundaryReason).toBe('orders_api_180_day_limit');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('lists plans for stores represented by the member SKU scope', async () => {
    let requestedStoreIds: string[] | undefined;
    const store: SyncPlanStore = {
      create: async () => [],
      get: async () => undefined,
      listIncremental: async (_tenantId, storeIds) => { requestedStoreIds = storeIds; return []; },
    };
    const app = makeApp(store, { tenantId: 'tenant-1', userId: 'member', role: 'member', storeIds: new Set(), skus: new Set(['store-1:SKU-1']) });
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync/plans`);
      expect(response.status).toBe(200);
      expect(requestedStoreIds).toEqual(['store-1']);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('does not allow members to change sync plans', async () => {
    let changed = false;
    const store: SyncPlanStore = { create: async () => [], get: async () => undefined, setStoreIncrementalEnabled: async () => { changed = true; return { enabled: true, planCount: 1 }; } };
    const app = makeApp(store, { tenantId: 'tenant-1', userId: 'member', role: 'member', storeIds: new Set(['store-1']) });
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync/plans/stores/store-1/incremental`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      expect(response.status).toBe(403);
      expect(changed).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
