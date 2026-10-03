import { Router } from 'express';
export function dashboardRouter(): Router { const r = Router(); r.get('/dashboard', (_req, res) => res.json({ requestId: res.locals.requestId, data: { freshness: null, metrics: {} }, error: null })); return r; }
