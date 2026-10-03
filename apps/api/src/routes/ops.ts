import { Router } from 'express';
export function opsRouter(stats: () => Promise<unknown> = async () => ({ queue: 'ok' })): Router { const r = Router(); r.get('/ops/health', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await stats(), error: null }); } catch (e) { return next(e); } }); return r; }
