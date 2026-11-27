import express from 'express';
import { describe, expect, it } from 'vitest';
import { loadSyncJobPage, loadSyncStatusJobResults, syncStatusRouter } from './sync-status.js';

describe('sync status visibility', () => {
  it('returns only stores and jobs visible through the member SKU scope', async () => {
    let requestedStores: string[] | undefined;
    const app = express();
    app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(syncStatusRouter({
      visibility: () => ({ tenantId: 'tenant-1', role: 'member', storeIds: new Set(), skus: new Set(['store-1:SKU-1']) }),
      list: async (_tenantId, _page, _pageSize, storeIds) => {
        requestedStores = storeIds;
        const visibleIds = new Set(storeIds);
        const stores = [{ id: 'store-1', name: 'My Store', environment: 'production' }, { id: 'store-2', name: 'Other Store', environment: 'production' }].filter((store) => visibleIds.has(store.id));
        const jobs = [
          { id: 'mine', storeId: 'store-1', resource: 'orders' },
          { id: 'other', storeId: 'store-2', resource: 'orders' },
          { id: 'tenant', storeId: '__tenant__', resource: 'head-freight' },
        ].filter((job) => visibleIds.has(job.storeId));
        return {
          jobs,
          stores,
          brightdataRuns: [{ runId: 'run-1', status: 'completed', totalItems: 3, successCount: 3, failCount: 0 }],
          pagination: { page: 1, pageSize: 20, total: jobs.length, totalPages: 1 },
        };
      },
    }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync-status`);
      const body = await response.json() as { data: { jobs: Array<{ id: string }>; stores: Array<{ id: string }>; brightdataRuns: Array<{ runId: string; status: string }> } };
      expect(response.status).toBe(200);
      expect(requestedStores).toEqual(['store-1']);
      expect(body.data.stores.map((store) => store.id)).toEqual(['store-1']);
      expect(body.data.jobs.map((job) => job.id)).toEqual(['mine']);
      expect(body.data.brightdataRuns).toEqual([{ runId: 'run-1', status: 'completed', totalItems: 3, successCount: 3, failCount: 0 }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('sync status job paging', () => {
  it('keeps jobs as an array when combining the count query with the paged job query', async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 2 }], {}] as any;
        if (sql.includes('SELECT j.id')) return [[{ id: 'job-1', tenantId: 'tenant-1' }, { id: 'job-2', tenantId: 'tenant-1' }], {}] as any;
        if (sql.includes('SELECT id, result_payload AS resultPayload')) return [[{ id: 'job-1', resultPayload: null }, { id: 'job-2', resultPayload: null }], {}] as any;
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    const result = await loadSyncStatusJobResults(pool, 'tenant-1', 1, 20);

    expect(result.total).toBe(2);
    expect(result.jobs).toEqual([
      { id: 'job-1', tenantId: 'tenant-1', resultPayload: null },
      { id: 'job-2', tenantId: 'tenant-1', resultPayload: null },
    ]);
    expect(Array.isArray(result.jobs)).toBe(true);
  });

  it('sorts and paginates job metadata before loading large result payloads', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT j.id')) {
          return [[
            { id: 'job-1', tenantId: 'tenant-1', resource: 'orders', createdAt: '2026-10-31 10:00:00' },
            { id: 'job-2', tenantId: 'tenant-1', resource: 'returns', createdAt: '2026-10-31 09:00:00' },
          ], {}] as any;
        }
        if (sql.includes('SELECT id, result_payload AS resultPayload')) {
          return [[
            { id: 'job-1', resultPayload: '{"rows":1000}' },
            { id: 'job-2', resultPayload: '{"rows":2500}' },
          ], {}] as any;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    const jobs = await loadSyncJobPage(pool, 'tenant-1', 2, 2);

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('ORDER BY j.created_at DESC, j.id DESC LIMIT ? OFFSET ?');
    expect(calls[0].sql).not.toContain('result_payload');
    expect(calls[0].params).toEqual(['tenant-1', 2, 2]);
    expect(calls[1].sql).toContain('WHERE tenant_id = ? AND id IN (?, ?)');
    expect(calls[1].sql).not.toContain('ORDER BY');
    expect(calls[1].params).toEqual(['tenant-1', 'job-1', 'job-2']);
    expect(jobs).toEqual([
      { id: 'job-1', tenantId: 'tenant-1', resource: 'orders', createdAt: '2026-10-31 10:00:00', resultPayload: '{"rows":1000}' },
      { id: 'job-2', tenantId: 'tenant-1', resource: 'returns', createdAt: '2026-10-31 09:00:00', resultPayload: '{"rows":2500}' },
    ]);
  });
});
