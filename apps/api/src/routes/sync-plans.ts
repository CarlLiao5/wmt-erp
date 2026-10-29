import { Router, type Request } from 'express';
import { and, createDb, eq, inArray, syncJobs, syncPlans, syncWindows } from '@walmart-erp/db';
import { randomUUID } from 'node:crypto';
import { requestSession } from './auth.js';
import { planInitialWindows } from './initialWindowPlanner.js';
import { createSyncQueue, enqueueSync, syncQueueNameForResource } from '../../../worker/src/queue.js';
import { INCREMENTAL_SYNC_POLICIES, incrementalSyncPolicy, nextScheduledRunAt } from '@walmart-erp/domain';

const RESOURCES = new Set(['orders', 'returns', 'inventory', 'storage-fees', 'pricing', 'item-report', 'head-freight', 'smart-sheet-allsku2026', 'freight-tracking', 'lingxing-advertising', 'lingxing-head-freight-costs', 'advertising', 'advertising-onsite', 'advertising-sem', 'advertising-sem-items', 'advertising-sem-performance', 'advertising-sem-search-terms', 'performance', 'weather']);

export interface SyncPlanSession { tenantId: string; userId?: string; role: 'admin' | 'member'; storeIds?: Set<string>; skus?: Set<string>; }
export interface SyncPlanCreateInput { tenantId: string; storeId: string; resources: string[]; mode: 'initial' | 'incremental'; requestedFrom?: string; requestedTo?: string; }
export interface SyncPlanResourceCoverage { resource: string; status?: string; coverageFrom?: string | Date | null; coverageTo?: string | Date | null; boundaryReason?: string | null; windowCount: number; completedWindows: number; failedWindows: number; lastError?: string | null; }
export interface SyncPlanView { id: string; status: string; resources: SyncPlanResourceCoverage[]; }
export interface IncrementalPlanView {
  id: string;
  storeId: string;
  storeName: string;
  resource: string;
  status: string;
  enabled: boolean;
  intervalMinutes: number;
  overlapDays: number;
  nextRunAt: Date | string | null;
  windowCount: number;
  completedWindows: number;
  failedWindows: number;
  latestWindow: { status: string; windowFrom: Date | string; windowTo: Date | string; createdAt: Date | string; lastError?: string | null } | null;
}
export interface SyncPlanStore {
  create(input: SyncPlanCreateInput): Promise<Array<{ id: string; resource: string; mode: string }>>;
  get(id: string, tenantId: string, storeIds?: string[]): Promise<SyncPlanView | undefined>;
  listIncremental?(tenantId: string, storeIds?: string[]): Promise<IncrementalPlanView[]>;
  setStoreIncrementalEnabled?(storeId: string, tenantId: string, enabled: boolean, storeIds?: string[]): Promise<{ enabled: boolean; planCount: number } | undefined>;
  setTenantIncrementalEnabled?(tenantId: string, enabled: boolean): Promise<{ enabled: boolean; planCount: number }>;
}
export interface SyncPlansRouterOptions { store: SyncPlanStore; session?: (req: Request) => Promise<SyncPlanSession | undefined>; }

export function mysqlSyncPlanStore(): SyncPlanStore {
  const syncQueues = new Map<string, ReturnType<typeof createSyncQueue>>();
  const queueForResource = (resource: string) => {
    const queueName = syncQueueNameForResource(resource);
    let queue = syncQueues.get(queueName);
    if (!queue) { queue = createSyncQueue(undefined, queueName); syncQueues.set(queueName, queue); }
    return queue.queue;
  };
  return {
    async create(input) {
      if (input.mode === 'incremental') {
        const unsupported = input.resources.filter((resource) => !incrementalSyncPolicy(resource));
        if (unsupported.length) throw new Error(`Incremental sync is not supported for: ${unsupported.join(', ')}`);
      }
      const { db, pool } = createDb();
      try {
        const now = new Date();
        const result: Array<{ id: string; resource: string; mode: string }> = [];
        for (const resource of input.resources) {
          const id = randomUUID();
          const policy = input.mode === 'incremental' ? incrementalSyncPolicy(resource) : undefined;
          await db.insert(syncPlans).values({ id, tenantId: input.tenantId, storeId: input.storeId, resource, mode: input.mode, requestedFrom: input.requestedFrom ? new Date(input.requestedFrom) : null, requestedTo: input.requestedTo ? new Date(input.requestedTo) : null, intervalMinutes: policy?.intervalMinutes ?? 0, overlapDays: policy?.overlapDays ?? 0, nextRunAt: policy ? nextScheduledRunAt(resource, now) : null, enabled: policy ? 1 : 0, createdAt: now, updatedAt: now }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
          const [row] = await db.select({ id: syncPlans.id, resource: syncPlans.resource, mode: syncPlans.mode, createdAt: syncPlans.createdAt }).from(syncPlans).where(and(eq(syncPlans.tenantId, input.tenantId), eq(syncPlans.storeId, input.storeId), eq(syncPlans.resource, resource), eq(syncPlans.mode, input.mode))).limit(1);
          if (row) {
            const windows = planInitialWindows({
              planId: row.id,
              tenantId: input.tenantId,
              storeId: input.storeId,
              resource,
              mode: input.mode,
              now: row.createdAt,
              requestedFrom: input.requestedFrom,
              requestedTo: input.requestedTo,
            });
            if (windows.length) {
              const existing = await db.select({ id: syncWindows.id, batchId: syncWindows.batchId, status: syncWindows.status }).from(syncWindows).where(and(eq(syncWindows.planId, row.id), eq(syncWindows.tenantId, input.tenantId)));
              const existingBatches = new Set(existing.map((window) => window.batchId));
              const canonicalBatches = new Set(windows.map((window) => window.batchId));
              const obsolete = existing.filter((window) => !canonicalBatches.has(window.batchId) && window.status === 'planned');
              for (const window of obsolete) {
                await db.update(syncWindows).set({ status: 'superseded', updatedAt: now }).where(eq(syncWindows.id, window.id));
              }
              await db.insert(syncWindows).values(windows).onDuplicateKeyUpdate({ set: { updatedAt: now } });
              const current = await db.select({ id: syncWindows.id, batchId: syncWindows.batchId, status: syncWindows.status }).from(syncWindows).where(and(eq(syncWindows.planId, row.id), eq(syncWindows.tenantId, input.tenantId)));
              const linkedJobs = await db.select({ syncWindowId: syncJobs.syncWindowId }).from(syncJobs).where(eq(syncJobs.tenantId, input.tenantId));
              const linkedWindowIds = new Set(linkedJobs.map((job) => job.syncWindowId).filter((id): id is string => id !== null));
              const pending = current.filter((window) => canonicalBatches.has(window.batchId) && window.status === 'planned' && !linkedWindowIds.has(window.id));
              for (const window of pending) {
                const planned = windows.find((item) => item.batchId === window.batchId);
                if (!planned) continue;
                await enqueueSync({
                  tenantId: input.tenantId,
                  storeId: input.storeId,
                  resource,
                  window: { from: planned.windowFrom.toISOString(), to: planned.windowTo.toISOString() },
                  batchId: window.batchId,
                  syncWindowId: window.id,
                }, queueForResource(resource));
              }
            }
            result.push(row);
          }
        }
        return result;
      } finally { await pool.end(); }
    },
    async get(id, tenantId, storeIds) {
      if (storeIds && storeIds.length === 0) return undefined;
      const { db, pool } = createDb();
      try {
        const [plan] = await db.select().from(syncPlans).where(and(eq(syncPlans.id, id), eq(syncPlans.tenantId, tenantId), storeIds ? inArray(syncPlans.storeId, storeIds) : undefined)).limit(1);
        if (!plan) return undefined;
        const windows = (await db.select().from(syncWindows).where(and(eq(syncWindows.planId, id), eq(syncWindows.tenantId, tenantId)))).filter((window) => window.status !== 'superseded');
        const resources = [{ resource: plan.resource, status: plan.status, coverageFrom: plan.coverageFrom, coverageTo: plan.coverageTo, boundaryReason: plan.boundaryReason, windowCount: windows.length, completedWindows: windows.filter((window) => window.status === 'completed').length, failedWindows: windows.filter((window) => window.status === 'failed').length, lastError: plan.lastError }];
        return { id: plan.id, status: plan.status, resources };
      } finally { await pool.end(); }
    },
    async setTenantIncrementalEnabled(tenantId, enabled) {
      const { pool } = createDb();
      const resources = ['head-freight', 'smart-sheet-allsku2026', 'freight-tracking', 'lingxing-advertising', 'lingxing-head-freight-costs'] as const;
      try {
        const now = new Date();
        if (enabled) {
          for (const resource of resources) {
            const policy = INCREMENTAL_SYNC_POLICIES[resource];
          await pool.query(`INSERT INTO sync_plans (id, tenant_id, store_id, resource, mode, status, interval_minutes, overlap_days, next_run_at, enabled, created_at, updated_at) VALUES (UUID(), ?, '__tenant__', ?, 'incremental', 'planned', ?, ?, ?, 1, ?, ?) ON DUPLICATE KEY UPDATE interval_minutes=VALUES(interval_minutes), overlap_days=VALUES(overlap_days), enabled=1, next_run_at=IF(next_run_at IS NULL, VALUES(next_run_at), next_run_at), updated_at=VALUES(updated_at)`, [tenantId, resource, policy.intervalMinutes, policy.overlapDays, nextScheduledRunAt(resource, now), now, now]);
          }
        } else {
          await pool.query(`UPDATE sync_plans SET enabled=0, next_run_at=NULL, updated_at=? WHERE tenant_id=? AND store_id='__tenant__' AND mode='incremental' AND resource IN ('head-freight','smart-sheet-allsku2026','freight-tracking','lingxing-advertising','lingxing-head-freight-costs')`, [now, tenantId]);
        }
        const [rows] = await pool.query(`SELECT COUNT(*) AS planCount FROM sync_plans WHERE tenant_id=? AND store_id='__tenant__' AND mode='incremental' AND resource IN ('head-freight','smart-sheet-allsku2026','freight-tracking','lingxing-advertising','lingxing-head-freight-costs')`, [tenantId]);
        return { enabled, planCount: Number((rows as Array<{ planCount: number }>)[0]?.planCount ?? 0) };
      } finally { await pool.end(); }
    },
    async listIncremental(tenantId, storeIds) {
      if (storeIds && storeIds.length === 0) return [];
      const { pool } = createDb();
      try {
        const storeFilter = storeIds ? ` AND p.store_id IN (${storeIds.map(() => '?').join(', ')})` : '';
        const [rows] = await pool.query(
          `SELECT p.id, p.store_id AS storeId, CASE WHEN p.store_id = '__tenant__' THEN '综合同步' ELSE COALESCE(s.name, p.store_id) END AS storeName, p.resource, p.status, p.enabled,
                  p.interval_minutes AS intervalMinutes, p.overlap_days AS overlapDays,
                  p.next_run_at AS nextRunAt, COUNT(w.id) AS windowCount,
                  SUM(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END) AS completedWindows,
                  SUM(CASE WHEN w.status = 'failed' THEN 1 ELSE 0 END) AS failedWindows
             FROM sync_plans p
             LEFT JOIN stores s ON s.id = p.store_id AND s.tenant_id = p.tenant_id
             LEFT JOIN sync_windows w ON w.plan_id = p.id AND w.tenant_id = p.tenant_id AND w.status <> 'superseded'
            WHERE p.tenant_id = ? AND p.mode = 'incremental'
              AND NOT (p.store_id = '__tenant__' AND p.resource = 'item-report')
              AND (p.store_id = '__tenant__' OR p.resource NOT IN ('head-freight', 'smart-sheet-allsku2026', 'freight-tracking', 'lingxing-head-freight-costs'))${storeFilter}
            GROUP BY p.id, p.store_id, s.name, p.resource, p.status, p.enabled,
                     p.interval_minutes, p.overlap_days, p.next_run_at
            ORDER BY p.store_id, p.resource`,
          [tenantId, ...(storeIds ?? [])],
        ) as [Array<Record<string, any>>, unknown];
        const plans: IncrementalPlanView[] = rows.map((row): IncrementalPlanView => ({
          id: String(row.id),
          storeId: String(row.storeId),
          storeName: String(row.storeName),
          resource: String(row.resource),
          status: String(row.status),
          enabled: Boolean(Number(row.enabled)),
          intervalMinutes: Number(row.intervalMinutes),
          overlapDays: Number(row.overlapDays),
          nextRunAt: row.nextRunAt,
          windowCount: Number(row.windowCount),
          completedWindows: Number(row.completedWindows ?? 0),
          failedWindows: Number(row.failedWindows ?? 0),
          latestWindow: null as IncrementalPlanView['latestWindow'],
        }));
        if (plans.length) {
          const ids = plans.map((plan) => plan.id);
          const [latestRows] = await pool.query(
            `SELECT id, plan_id AS planId, status, window_from AS windowFrom,
                    window_to AS windowTo, created_at AS createdAt, last_error AS lastError
               FROM (
                 SELECT w.*, ROW_NUMBER() OVER (PARTITION BY w.plan_id ORDER BY w.created_at DESC, w.id DESC) AS rowNum
                   FROM sync_windows w
                  WHERE w.tenant_id = ? AND w.plan_id IN (${ids.map(() => '?').join(', ')}) AND w.status <> 'superseded'
               ) ranked
              WHERE rowNum = 1`,
            [tenantId, ...ids],
          ) as [Array<Record<string, any>>, unknown];
          const latestByPlan = new Map(latestRows.map((row) => [row.planId, row]));
          for (const plan of plans) {
            const latest = latestByPlan.get(plan.id);
            if (latest) plan.latestWindow = { status: latest.status, windowFrom: latest.windowFrom, windowTo: latest.windowTo, createdAt: latest.createdAt, lastError: latest.lastError };
          }
        }
        return plans as IncrementalPlanView[];
      } finally { await pool.end(); }
    },
    async setStoreIncrementalEnabled(storeId, tenantId, enabled, storeIds) {
      if (storeIds && !storeIds.includes(storeId)) return undefined;
      const { pool } = createDb();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [storesForTenant] = await connection.query(
          'SELECT id FROM stores WHERE id = ? AND tenant_id = ? FOR UPDATE',
          [storeId, tenantId],
        );
        if (!(storesForTenant as Array<{ id: string }>).length) {
          await connection.commit();
          return undefined;
        }

        const now = new Date();
        if (enabled) {
          for (const [resource, policy] of Object.entries(INCREMENTAL_SYNC_POLICIES).filter(([resource]) => !['head-freight', 'smart-sheet-allsku2026', 'freight-tracking', 'lingxing-head-freight-costs'].includes(resource))) {
            await connection.query(
              `INSERT INTO sync_plans
                (id, tenant_id, store_id, resource, mode, status, interval_minutes, overlap_days, next_run_at, enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'incremental', 'planned', ?, ?, ?, 1, ?, ?)
               ON DUPLICATE KEY UPDATE
                 interval_minutes = VALUES(interval_minutes),
                 overlap_days = VALUES(overlap_days),
                 enabled = 1,
                 next_run_at = IF(next_run_at IS NULL, VALUES(next_run_at), next_run_at),
                 updated_at = VALUES(updated_at)`,
              [randomUUID(), tenantId, storeId, resource, policy.intervalMinutes, policy.overlapDays, nextScheduledRunAt(resource, now, now, policy.intervalMinutes, storeId), now, now],
            );
          }
        } else {
          await connection.query(
            `UPDATE sync_plans SET enabled = 0, next_run_at = NULL, updated_at = ?
              WHERE tenant_id = ? AND store_id = ? AND mode = 'incremental'`,
            [now, tenantId, storeId],
          );
          await connection.query(
            `UPDATE sync_windows w
               INNER JOIN sync_plans p ON p.id = w.plan_id AND p.tenant_id = w.tenant_id
                SET w.status = 'superseded', w.updated_at = ?
              WHERE p.tenant_id = ? AND p.store_id = ? AND p.mode = 'incremental' AND w.status = 'planned'`,
            [now, tenantId, storeId],
          );
        }
        const [countRows] = await connection.query(
          "SELECT COUNT(*) AS planCount FROM sync_plans WHERE tenant_id = ? AND store_id = ? AND mode = 'incremental'",
          [tenantId, storeId],
        );
        await connection.commit();
        return { enabled, planCount: Number((countRows as Array<{ planCount: number }>)[0]?.planCount ?? 0) };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
        await pool.end();
      }
    },
  };
}

export function syncPlansRouter(options: SyncPlansRouterOptions): Router {
  const router = Router();
  const session = options.session ?? requestSession;
  const visibleStoreIds = (current: SyncPlanSession): string[] | undefined => {
    if (current.role === 'admin') return undefined;
    const ids = new Set(current.storeIds ?? []);
    for (const grant of current.skus ?? []) {
      const separator = grant.indexOf(':');
      if (separator > 0) ids.add(grant.slice(0, separator));
    }
    return [...ids];
  };
  router.get('/sync/plans', async (req, res, next) => {
    try {
      const current = (await session(req)) as SyncPlanSession | undefined;
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      if (!options.store.listIncremental) return res.status(501).json({ requestId: res.locals.requestId, data: null, error: { message: 'Incremental plan listing is not configured' } });
      const plans = await options.store.listIncremental(current.tenantId, visibleStoreIds(current));
      return res.json({ requestId: res.locals.requestId, data: { plans }, error: null });
    } catch (error) { return next(error); }
  });
  router.post('/sync/plans', async (req, res, next) => {
    try {
      const current = (await session(req)) as SyncPlanSession | undefined;
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      if (current.role !== 'admin') return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Administrator access required' } });
      const body = req.body as { storeId?: string; resources?: string[]; mode?: string; requestedFrom?: string; requestedTo?: string };
      const resources = Array.isArray(body.resources) ? [...new Set(body.resources.filter((resource): resource is string => typeof resource === 'string' && RESOURCES.has(resource)))] : [];
      if (!body.storeId || !resources.length || !['initial', 'incremental'].includes(body.mode ?? '')) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'storeId, resources, and mode are required' } });
      if (body.mode === 'incremental') {
        const unsupported = resources.filter((resource) => !incrementalSyncPolicy(resource));
        if (unsupported.length) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: `Incremental sync is not supported for: ${unsupported.join(', ')}` } });
      }
      if (current.role !== 'admin' && !current.storeIds?.has(body.storeId)) return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } });
      const plans = await options.store.create({ tenantId: current.tenantId, storeId: body.storeId, resources, mode: body.mode as 'initial' | 'incremental', requestedFrom: body.requestedFrom, requestedTo: body.requestedTo });
      return res.status(202).json({ requestId: res.locals.requestId, data: { plans }, error: null });
    } catch (error) { return next(error); }
  });
  router.get('/sync/plans/:id', async (req, res, next) => {
    try {
      const current = (await session(req)) as SyncPlanSession | undefined;
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      const plan = await options.store.get(req.params.id, current.tenantId, visibleStoreIds(current));
      if (!plan) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Sync plan not found' } });
      return res.json({ requestId: res.locals.requestId, data: plan, error: null });
    } catch (error) { return next(error); }
  });
  router.patch('/sync/plans/stores/:storeId/incremental', async (req, res, next) => {
    try {
      const current = (await session(req)) as SyncPlanSession | undefined;
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      if (current.role !== 'admin') return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Administrator access required' } });
      const body = req.body as { enabled?: unknown };
      if (typeof body.enabled !== 'boolean') return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'enabled must be a boolean' } });
      if (!options.store.setStoreIncrementalEnabled) return res.status(501).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store incremental control is not configured' } });
      const result = await options.store.setStoreIncrementalEnabled(req.params.storeId, current.tenantId, body.enabled, visibleStoreIds(current));
      if (!result) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store not found' } });
      return res.json({ requestId: res.locals.requestId, data: result, error: null });
    } catch (error) { return next(error); }
  });
  router.patch('/sync/plans/tenant/incremental', async (req, res, next) => {
    try {
      const current = (await session(req)) as SyncPlanSession | undefined;
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      if (current.role !== 'admin') return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Administrator access required' } });
      if (typeof (req.body as { enabled?: unknown }).enabled !== 'boolean' || !options.store.setTenantIncrementalEnabled) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'enabled must be a boolean' } });
      return res.json({ requestId: res.locals.requestId, data: await options.store.setTenantIncrementalEnabled(current.tenantId, req.body.enabled), error: null });
    } catch (error) { return next(error); }
  });
  return router;
}
