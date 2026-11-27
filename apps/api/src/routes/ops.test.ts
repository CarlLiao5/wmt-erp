import express from 'express';
import { describe, expect, it } from 'vitest';
import { canReplaySyncJob, opsRouter } from './ops.js';

describe('operations controls', () => {
  it('only allows an admin to replay a failed job in the same tenant', () => {
    expect(canReplaySyncJob({ tenantId: 't1', status: 'failed' }, { tenantId: 't1', role: 'admin' })).toBe(true);
    expect(canReplaySyncJob({ tenantId: 't2', status: 'failed' }, { tenantId: 't1', role: 'admin' })).toBe(false);
    expect(canReplaySyncJob({ tenantId: 't1', status: 'completed' }, { tenantId: 't1', role: 'admin' })).toBe(false);
    expect(canReplaySyncJob({ tenantId: 't1', status: 'failed' }, { tenantId: 't1', role: 'member' })).toBe(false);
  });

  it('returns scoped health and a local replay response', async () => {
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test-request'; next(); });
    app.use(opsRouter({ session: async () => ({ tenantId: 't1', role: 'admin' }), stats: async (tenantId) => ({ queued: tenantId === 't1' ? 1 : 0, running: 0, completed: 2, failed: 0, failureRate: 0, latestSuccessAt: null, staleResources: [] }), replay: async (jobId, tenantId) => ({ jobId, tenantId, status: 'queued' }) }));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start'); const base = `http://127.0.0.1:${address.port}`;
    try { const health = await fetch(`${base}/operations/sync-health`); expect(health.status).toBe(200); expect((await health.json()).data.queued).toBe(1); const replay = await fetch(`${base}/sync-jobs/job-1/replay`, { method: 'POST' }); expect(replay.status).toBe(202); expect((await replay.json()).data.status).toBe('queued'); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('returns redacted runtime configuration status', async () => {
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test-request'; next(); });
    app.use(opsRouter({ session: async () => ({ tenantId: 't1', role: 'admin' }), runtime: async () => ({ api: { mysqlUrl: true, redisUrl: true, credentialKey: true }, dependencies: { mysql: 'ok', redis: 'ok' }, worker: 'ok', checkedAt: '2026-10-29T00:00:00.000Z' }) }));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try { const response = await fetch(`http://127.0.0.1:${address.port}/operations/runtime-status`); expect(response.status).toBe(200); const body = await response.json() as { data: Record<string, unknown> }; expect(body.data).toMatchObject({ worker: 'ok', status: 'ok' }); expect(JSON.stringify(body)).not.toContain('secret'); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
