import { Router, type Request } from 'express';
import { and, createDb, eq, gte, lte, performanceSnapshots } from '@walmart-erp/db';
import { requestSession } from './auth.js';

export function marketingMetrics(sales: number, adSpend: number) { return { acos: sales ? adSpend / sales : 0, roas: adSpend ? sales / adSpend : 0 }; }
export interface PerformanceListOptions { list?: (tenantId: string, storeId?: string, from?: string, to?: string) => Promise<unknown[]>; visibility?: (req: Request) => Promise<{ tenantId?: string; role: 'admin' | 'member'; storeIds: Set<string> } | undefined>; }

export function mysqlPerformanceSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string) => {
  const { db, pool } = createDb();
  try {
    const conditions = [eq(performanceSnapshots.tenantId, tenantId), ...(storeId ? [eq(performanceSnapshots.storeId, storeId)] : []), ...(from ? [gte(performanceSnapshots.periodEnd, new Date(from))] : []), ...(to ? [lte(performanceSnapshots.periodEnd, new Date(`${to}T23:59:59.999Z`))] : [])];
    const rows = await db.select().from(performanceSnapshots).where(and(...conditions));
    // Walmart returns a fresh rolling period on every sync. For each store and
    // metric, keep the newest snapshot instead of rendering stale periods too.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.storeId}|${row.metric}`;
      const previous = latest.get(key);
      if (!previous || new Date(row.receivedAt).getTime() >= new Date(previous.receivedAt).getTime()) latest.set(key, row);
    }
    return [...latest.values()];
  } finally { await pool.end(); }
}; }

export function performanceRouter(options: PerformanceListOptions = {}): Router { const r = Router(); r.get('/performance', async (req, res, next) => { try { const session = await requestSession(req); if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } }); const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined; const scope = options.visibility ? await options.visibility(req) : undefined; if (storeId && scope?.role !== 'admin' && !scope?.storeIds.has(storeId)) return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } }); const rows = await (options.list ?? mysqlPerformanceSource())(session.tenantId, storeId, typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined); const typedRows = rows as any[]; return res.json({ requestId: res.locals.requestId, data: { rows: typedRows, dataAvailable: typedRows.length > 0, source: 'walmart', lastSyncedAt: typedRows.length ? typedRows.reduce((max: string | Date, row: any) => new Date(row.receivedAt) > new Date(max) ? row.receivedAt : max, typedRows[0].receivedAt) : null }, error: null }); } catch (e) { return next(e); } }); return r; }
