import { Router } from 'express';
export function syncStatusRouter(): Router { const r = Router(); r.get('/sync-status', (_req, res) => res.json({ requestId: res.locals.requestId, data: { jobs: [] }, error: null })); return r; }
