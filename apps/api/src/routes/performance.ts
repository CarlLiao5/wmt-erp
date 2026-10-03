import { Router } from 'express';
export function marketingMetrics(sales: number, adSpend: number) { return { acos: sales ? adSpend / sales : 0, roas: adSpend ? sales / adSpend : 0 }; }
export function performanceRouter(list: () => Promise<unknown[]> = async () => []): Router { const r = Router(); r.get('/performance', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await list(), error: null }); } catch (e) { return next(e); } }); return r; }
