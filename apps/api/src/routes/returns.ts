import { Router } from 'express';
export interface ReturnRecord { id: string; orderId: string; storeId: string; status: string; amount: number; }
export function filterVisibleReturns(rows: ReturnRecord[], storeIds: Set<string>, role: 'admin' | 'member') { return role === 'admin' ? rows : rows.filter((r) => storeIds.has(r.storeId)); }
export function returnsRouter(list: () => Promise<ReturnRecord[]> = async () => []): Router { const r = Router(); r.get('/returns', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await list(), error: null }); } catch (e) { return next(e); } }); return r; }
