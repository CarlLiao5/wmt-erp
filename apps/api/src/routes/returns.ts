import { Router, type Request } from 'express';
import type { OrderVisibility } from './orders.js';
export interface ReturnRecord { id: string; tenantId?: string; orderId: string; storeId: string; sku: string; status: string; amount: number; returnedAt?: string; }
export function filterVisibleReturns(rows: ReturnRecord[], storeIds: Set<string>, role: 'admin' | 'member') { return role === 'admin' ? rows : rows.filter((r) => storeIds.has(r.storeId)); }
export interface ReturnsRouterOptions { list: () => Promise<ReturnRecord[]>; visibility: (req: Request) => OrderVisibility | undefined; }
export function returnsRouter(input: ReturnsRouterOptions | (() => Promise<ReturnRecord[]>) = async () => []): Router {
  const options: ReturnsRouterOptions = typeof input === 'function' ? { list: input, visibility: () => undefined } : input;
  const r = Router();
  r.get('/returns', async (req, res, next) => { try {
    const v = options.visibility(req);
    if (!v?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    const rows = (await options.list()).filter((row) => row.tenantId === v.tenantId && (v.role === 'admin' || v.storeIds.has(row.storeId) || v.skus.has(row.sku)) && (typeof req.query.storeId !== 'string' || row.storeId === req.query.storeId) && (typeof req.query.sku !== 'string' || row.sku === req.query.sku) && (typeof req.query.status !== 'string' || row.status === req.query.status) && (typeof req.query.from !== 'string' || (row.returnedAt ?? '').slice(0, 10) >= req.query.from) && (typeof req.query.to !== 'string' || (row.returnedAt ?? '').slice(0, 10) <= req.query.to));
    const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    return res.json({ requestId: res.locals.requestId, data: { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }, error: null });
  } catch (e) { return next(e); } }); return r;
}
