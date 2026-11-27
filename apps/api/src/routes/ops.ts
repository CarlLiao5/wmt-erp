import { Router, type Request } from 'express';
import { createDb, syncJobs } from '@walmart-erp/db';
import { eq } from '@walmart-erp/db';
import { createSyncQueue } from '../../../worker/src/queue.js';
import { requestSession } from './auth.js';
import { replayWithClaim } from './ops-replay.js';

export interface SyncHealth { queued: number; running: number; completed: number; failed: number; failureRate: number; latestSuccessAt: Date | null; staleResources: string[]; }
export interface RuntimeStatus { api: { mysqlUrl: boolean; redisUrl: boolean; credentialKey: boolean }; dependencies: { mysql: 'ok' | 'error'; redis: 'ok' | 'error' }; worker: 'ok' | 'error' | 'unknown'; checkedAt: string; }
export function canReplaySyncJob(job: { tenantId: string; status: string }, session: { tenantId: string; role: string }) { return session.role === 'admin' && job.tenantId === session.tenantId && job.status === 'failed'; }

async function mysqlSyncHealth(tenantId: string): Promise<SyncHealth> {
  const { pool } = createDb();
  try {
    const [[counts], [latest], [stale]] = await Promise.all([
      pool.query('SELECT status, COUNT(*) AS total FROM sync_jobs WHERE tenant_id = ? GROUP BY status', [tenantId]),
      pool.query('SELECT MAX(completed_at) AS latestSuccessAt FROM sync_jobs WHERE tenant_id = ? AND status = ?', [tenantId, 'completed']),
      pool.query('SELECT resource, MAX(received_at) AS latestReceivedAt FROM raw_payloads WHERE tenant_id = ? GROUP BY resource HAVING MAX(received_at) < UTC_TIMESTAMP() - INTERVAL 48 HOUR', [tenantId]),
    ]) as any;
    const result: SyncHealth = { queued: 0, running: 0, completed: 0, failed: 0, failureRate: 0, latestSuccessAt: latest?.[0]?.latestSuccessAt ?? null, staleResources: (stale ?? []).map((row: { resource: string }) => row.resource) };
    for (const row of counts ?? []) if (row.status in result) result[row.status as keyof Pick<SyncHealth, 'queued' | 'running' | 'completed' | 'failed'>] = Number(row.total);
    const terminal = result.completed + result.failed;
    result.failureRate = terminal ? result.failed / terminal : 0;
    return result;
  } finally { await pool.end(); }
}

async function mysqlRuntimeStatus(): Promise<RuntimeStatus> {
  const status: RuntimeStatus = {
    api: { mysqlUrl: Boolean(process.env.MYSQL_URL), redisUrl: Boolean(process.env.REDIS_URL), credentialKey: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY) },
    dependencies: { mysql: 'error', redis: 'error' }, worker: 'unknown', checkedAt: new Date().toISOString(),
  };
  if (status.api.mysqlUrl) {
    const { pool } = createDb();
    try { await pool.query('SELECT 1'); status.dependencies.mysql = 'ok'; } catch { /* status remains error */ } finally { await pool.end(); }
  }
  if (status.api.redisUrl) {
    const { queue, redis } = createSyncQueue();
    try { await redis.ping(); status.dependencies.redis = 'ok'; const heartbeat = await redis.get('wmterp:worker:heartbeat'); status.worker = heartbeat && Number(heartbeat) > Date.now() - 30_000 ? 'ok' : 'error'; } catch { /* status remains error */ } finally { await queue.close(); await redis.quit(); }
  }
  return status;
}

async function replaySyncJob(jobId: string, tenantId: string) {
  const { db, pool } = createDb();
  try {
    const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);
    if (!job || job.tenantId !== tenantId || job.status !== 'failed') return undefined;
    const { queue, redis } = createSyncQueue();
    try {
      const queued = await queue.getJob(job.idempotencyKey);
      const replayed = await replayWithClaim({
        claim: async () => {
          const [result] = await pool.query('UPDATE sync_jobs SET status = ?, available_at = ? WHERE id = ? AND tenant_id = ? AND status = ?', ['queued', new Date(), job.id, tenantId, 'failed']) as any;
          return Number(result?.affectedRows ?? 0) === 1;
        },
        retry: async () => { if (!queued) return false; await queued.retry('failed'); },
        rollback: async () => { await db.update(syncJobs).set({ status: 'failed' }).where(eq(syncJobs.id, job.id)); },
      });
      return replayed ? { id: job.id, idempotencyKey: job.idempotencyKey, status: 'queued' } : undefined;
    } finally { await queue.close(); await redis.quit(); }
  } finally { await pool.end(); }
}

export interface OpsRouterOptions { stats?: (tenantId: string) => Promise<SyncHealth>; runtime?: () => Promise<RuntimeStatus>; replay?: (jobId: string, tenantId: string) => Promise<unknown>; session?: (req: Request) => Promise<{ tenantId: string; role: 'admin' | 'member' } | undefined>; }
export function opsRouter(options: OpsRouterOptions = {}): Router {
  const r = Router(); const getSession = options.session ?? requestSession;
  r.get('/operations/runtime-status', async (req, res, next) => { try { const session = await getSession(req); if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated tenant required' } }); const status = await (options.runtime ?? mysqlRuntimeStatus)(); const healthy = status.dependencies.mysql === 'ok' && status.dependencies.redis === 'ok' && status.worker === 'ok'; const data = session.role === 'admin' ? { ...status, status: healthy ? 'ok' : 'error' } : { status: healthy ? 'ok' : 'error', checkedAt: status.checkedAt, components: { api: 'ok', mysql: status.dependencies.mysql, redis: status.dependencies.redis, worker: status.worker } }; return res.json({ requestId: res.locals.requestId, data, error: null }); } catch (error) { return next(error); } });
  r.get('/operations/sync-health', async (req, res, next) => { try { const session = await getSession(req); if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated tenant required' } }); return res.json({ requestId: res.locals.requestId, data: await (options.stats ?? mysqlSyncHealth)(session.tenantId), error: null }); } catch (error) { return next(error); } });
  r.post('/sync-jobs/:id/replay', async (req, res, next) => { try { const session = await getSession(req); if (!session?.tenantId || session.role !== 'admin') return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Only administrators can replay sync jobs' } }); const result = await (options.replay ?? replaySyncJob)(req.params.id, session.tenantId); if (!result) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Failed sync job not found' } }); return res.status(202).json({ requestId: res.locals.requestId, data: result, error: null }); } catch (error) { return next(error); } });
  return r;
}
