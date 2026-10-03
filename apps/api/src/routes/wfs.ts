import { Router } from 'express';
export function wfsRouter(list: () => Promise<unknown[]> = async () => []): Router { const r = Router(); r.get('/wfs', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await list(), error: null }); } catch (e) { return next(e); } }); return r; }
