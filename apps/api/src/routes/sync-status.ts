import { Router, type Request } from 'express';
import { and, brightdataRunHistory, createDb, eq, inArray, stores } from '@walmart-erp/db';
import { requestSession } from './auth.js';
import type { OrderVisibility } from './orders.js';

export interface SyncStatusData {
  jobs: Array<Record<string, unknown>>;
  stores: Array<{ id: string; name: string; environment: string }>;
  brightdataRuns?: Array<Record<string, unknown>>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
export type SyncStatusScope = 'all' | 'tenant' | 'store';
export type SyncStatusSource = (tenantId: string, page: number, pageSize: number, storeIds?: string[], scope?: SyncStatusScope) => Promise<SyncStatusData>;
export type SyncStatusVisibility = (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined;

function visibleStoreIds(scope: OrderVisibility): string[] | undefined {
  if (scope.role === 'admin') return undefined;
  const ids = new Set(scope.storeIds);
  for (const grant of scope.skus) {
    const separator = grant.indexOf(':');
    if (separator > 0) ids.add(grant.slice(0, separator));
  }
  return [...ids];
}

type SyncJobsPool = { query: (sql: string, params: unknown[]) => Promise<[any[], unknown]> };

export async function loadSyncJobPage(
  pool: SyncJobsPool,
  tenantId: string,
  page: number,
  pageSize: number,
  storeIds?: string[],
  scope: SyncStatusScope = 'all',
): Promise<Array<Record<string, unknown>>> {
  const buildStoreClause = (prefix: string) => storeIds
    ? storeIds.length > 0
      ? ` AND (${prefix}store_id IN (${storeIds.map(() => '?').join(', ')}) OR ${prefix}resource = ?)`
      : ` AND ${prefix}resource = ?`
    : '';
  const storeParams = storeIds ? [...storeIds, 'brightdata-inventory'] : [];
  const buildScopeClause = (prefix: string) => scope === 'tenant' ? ` AND ${prefix}store_id = ?` : scope === 'store' ? ` AND ${prefix}store_id <> ?` : '';
  const scopeParams = scope === 'all' ? [] : ['__tenant__'];
  const [pageRows] = await pool.query(
    `SELECT j.id, j.tenant_id AS tenantId, j.store_id AS storeId, j.resource, j.idempotency_key AS idempotencyKey, j.status, j.attempts, j.available_at AS availableAt, j.completed_at AS completedAt, j.created_at AS createdAt, w.plan_id AS syncPlanId, p.mode AS syncMode, w.window_from AS windowFrom, w.window_to AS windowTo FROM sync_jobs j LEFT JOIN sync_windows w ON w.id = j.sync_window_id LEFT JOIN sync_plans p ON p.id = w.plan_id WHERE j.tenant_id = ?${buildStoreClause('j.')}${buildScopeClause('j.')} ORDER BY j.created_at DESC, j.id DESC LIMIT ? OFFSET ?`,
    [tenantId, ...storeParams, ...scopeParams, pageSize, (page - 1) * pageSize],
  );
  if (!pageRows.length) return pageRows;

  const ids = pageRows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const [payloadRows] = await pool.query(
    `SELECT id, result_payload AS resultPayload FROM sync_jobs WHERE tenant_id = ? AND id IN (${placeholders})`,
    [tenantId, ...ids],
  );
  const payloadById = new Map(payloadRows.map((row) => [row.id, row.resultPayload]));
  return pageRows.map((row) => ({ ...row, resultPayload: payloadById.get(row.id) ?? null }));
}

export async function loadSyncStatusJobResults(
  pool: SyncJobsPool,
  tenantId: string,
  page: number,
  pageSize: number,
  storeIds?: string[],
  scope: SyncStatusScope = 'all',
): Promise<{ total: number; jobs: Array<Record<string, unknown>> }> {
  const buildStoreClause = (prefix: string) => storeIds
    ? storeIds.length > 0
      ? ` AND (${prefix}store_id IN (${storeIds.map(() => '?').join(', ')}) OR ${prefix}resource = ?)`
      : ` AND ${prefix}resource = ?`
    : '';
  const storeParams = storeIds ? [...storeIds, 'brightdata-inventory'] : [];
  const buildScopeClause = (prefix: string) => scope === 'tenant' ? ` AND ${prefix}store_id = ?` : scope === 'store' ? ` AND ${prefix}store_id <> ?` : '';
  const scopeParams = scope === 'all' ? [] : ['__tenant__'];
  const [[countRows], jobs] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM sync_jobs WHERE tenant_id = ?${buildStoreClause('')}${buildScopeClause('')}`, [tenantId, ...storeParams, ...scopeParams]),
    loadSyncJobPage(pool, tenantId, page, pageSize, storeIds, scope),
  ]);
  return { total: Number(countRows?.[0]?.total ?? 0), jobs };
}

export function mysqlSyncStatusSource(): SyncStatusSource {
  return async (tenantId, page, pageSize, storeIds, scope = 'all') => {
    const { db, pool } = createDb();
    try {
      const [{ total, jobs }, [storeRows, brightdataRuns]] = await Promise.all([
        loadSyncStatusJobResults(pool, tenantId, page, pageSize, storeIds, scope),
        Promise.all([
          db.select({ id: stores.id, name: stores.name, environment: stores.environment }).from(stores).where(and(eq(stores.tenantId, tenantId), storeIds ? inArray(stores.id, storeIds) : undefined)),
          db.select().from(brightdataRunHistory).where(eq(brightdataRunHistory.tenantId, tenantId)).orderBy(brightdataRunHistory.startedAt).limit(20),
        ]),
      ]);
      return { jobs, stores: storeRows, brightdataRuns, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
    } finally {
      await pool.end();
    }
  };
}

export function syncStatusRouter(options: { list?: SyncStatusSource; visibility?: SyncStatusVisibility } = {}): Router {
  const router = Router();
  const list = options.list ?? mysqlSyncStatusSource();
  const visibility = options.visibility ?? (async (req: Request) => {
    const session = await requestSession(req);
    return session ? { tenantId: session.tenantId, role: session.role, storeIds: new Set<string>(), skus: new Set<string>() } : undefined;
  });
  router.get('/sync-status', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated tenant required' } });
      const requestedPage = Number(req.query.page ?? 1);
      const requestedPageSize = Number(req.query.pageSize ?? 20);
      const requestedScope = String(req.query.scope ?? 'all');
      if (!['all', 'tenant', 'store'].includes(requestedScope)) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'Invalid sync task scope' } });
      const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
      const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? Math.min(500, Math.floor(requestedPageSize)) : 20;
      // Tenant-level history is safe to expose to authenticated users because it contains
      // scheduler status and counts only; store-level rows keep the existing visibility rules.
      const data = await list(scope.tenantId, page, pageSize, requestedScope === 'tenant' ? undefined : visibleStoreIds(scope), requestedScope as SyncStatusScope);
      return res.json({ requestId: res.locals.requestId, data, error: null });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
