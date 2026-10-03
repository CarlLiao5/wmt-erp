import { Router } from 'express';
import { createDb, listStores, createStore } from '../../../../packages/db/index.js';
export function mysqlStoresRouter(tenantId = process.env.DEFAULT_TENANT_ID ?? 'default'): Router {
  const { db } = createDb(); const r = Router();
  r.get('/stores', async (_req, res, next) => { try { const rows = await listStores(db, tenantId); return res.json({ requestId: res.locals.requestId, data: rows, error: null }); } catch (e) { return next(e); } });
  r.post('/stores', async (req, res, next) => { try { const body = req.body as { id?: string; name?: string }; if (!body.id || !body.name) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: '店铺信息不完整' } }); const row = { id: body.id, tenantId, name: body.name, marketplace: 'walmart', timezone: 'UTC', createdAt: new Date() }; await createStore(db, row); return res.status(201).json({ requestId: res.locals.requestId, data: row, error: null }); } catch (e) { return next(e); } }); return r;
}
