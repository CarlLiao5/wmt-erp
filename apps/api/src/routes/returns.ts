import { Router, type Request } from 'express';
import type { OrderVisibility } from './orders.js';
export interface ReturnRecord { id: string; tenantId?: string; orderId: string; orderNumber?: string; itemId?: string; storeId: string; sku: string; status: string; amount: number; returnedAt?: string; }
export function filterVisibleReturns(rows: ReturnRecord[], storeIds: Set<string>, role: 'admin' | 'member') { return role === 'admin' ? rows : rows.filter((r) => storeIds.has(r.storeId)); }
export interface ReturnHistoryRecord { id: string; returnId: string; status: string; refundAmount: number; returnedAt: string; rawResponseId: string; }
export interface ReturnsRouterOptions { list: (tenantId: string) => Promise<ReturnRecord[]>; visibility: (req: Request) => OrderVisibility | Promise<OrderVisibility | undefined> | undefined; history?: (tenantId: string) => Promise<ReturnHistoryRecord[]>; }
export function returnsRouter(input: ReturnsRouterOptions | (() => Promise<ReturnRecord[]>) = async () => []): Router {
  const options: ReturnsRouterOptions = typeof input === 'function' ? { list: input, visibility: () => undefined } : input;
  const r = Router();
  const visible = async (v: OrderVisibility) => (await options.list(v.tenantId!)).filter((row) => row.tenantId === v.tenantId && (v.role === 'admin' || v.storeIds.has(row.storeId) || v.skus.has(`${row.storeId}:${row.sku}`)));
  r.get('/returns', async (req, res, next) => { try {
    const v = await options.visibility(req);
    if (!v?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    const rows = (await visible(v)).filter((row) => (typeof req.query.storeId !== 'string' || row.storeId === req.query.storeId) && (typeof req.query.sku !== 'string' || row.sku === req.query.sku) && (typeof req.query.orderNumber !== 'string' || row.orderNumber === req.query.orderNumber) && (typeof req.query.itemId !== 'string' || row.itemId === req.query.itemId) && (typeof req.query.status !== 'string' || row.status === req.query.status) && (typeof req.query.from !== 'string' || (row.returnedAt ?? '').slice(0, 10) >= req.query.from) && (typeof req.query.to !== 'string' || (row.returnedAt ?? '').slice(0, 10) <= req.query.to));
    const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    return res.json({ requestId: res.locals.requestId, data: { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, dateBasis: 'returnedAt' }, error: null });
  } catch (e) { return next(e); } });
  r.get('/returns/:id/history', async (req, res, next) => { try {
    const v = await options.visibility(req);
    if (!v?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    if (!(await visible(v)).some((row) => row.id === req.params.id)) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Return not found' } });
    const history = options.history ? await options.history(v.tenantId) : [];
    return res.json({ requestId: res.locals.requestId, data: history.filter((snapshot) => snapshot.returnId === req.params.id), error: null });
  } catch (error) { return next(error); } });
  return r;
}
