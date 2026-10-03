import { Router } from 'express';
export interface ReturnRecord { id: string; orderId: string; storeId: string; status: string; amount: number; }
export function returnsRouter(list: () => Promise<ReturnRecord[]> = async () => []): Router { const r = Router(); r.get('/returns', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await list(), error: null }); } catch (e) { return next(e); } }); return r; }
