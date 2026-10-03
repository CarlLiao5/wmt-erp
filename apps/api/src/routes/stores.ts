import { Router } from 'express';
export function storesRouter(enqueueSync: (storeId: string) => Promise<unknown>): Router { const r = Router(); r.post('/stores/:id/sync', async (req, res, next) => { try { const job = await enqueueSync(req.params.id); return res.status(202).json({ requestId: res.locals.requestId, data: job, error: null }); } catch (e) { return next(e); } }); return r; }
