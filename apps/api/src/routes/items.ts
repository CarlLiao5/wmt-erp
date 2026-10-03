import { Router } from 'express';
export interface ItemRecord { id: string; storeId: string; sku: string; title?: string; }
export function itemsRouter(list: (storeId?: string) => Promise<ItemRecord[]> = async () => []): Router {
  const r = Router();
  r.get('/items', async (req, res, next) => { try { const data = await list(typeof req.query.storeId === 'string' ? req.query.storeId : undefined); return res.json({ requestId: res.locals.requestId, data, error: null }); } catch (e) { return next(e); } });
  return r;
}
