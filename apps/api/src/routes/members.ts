import { Router } from 'express';
export interface Member { id: string; email: string; role: 'admin' | 'member'; }
export function membersRouter(list: () => Promise<Member[]> = async () => []): Router { const r = Router(); r.get('/members', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await list(), error: null }); } catch (e) { return next(e); } }); return r; }
