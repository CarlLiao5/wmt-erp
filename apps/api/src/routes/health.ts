import { Router } from 'express';
export function healthRouter(): Router { const r = Router(); r.get('/health', (_req, res) => res.json({ requestId: res.locals.requestId, data: { status: 'ok' }, error: null })); return r; }
