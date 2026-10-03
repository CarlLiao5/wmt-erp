import { Router } from 'express';
export interface ItemRecord { id: string; storeId: string; sku: string; title?: string; }
export interface Visibility { role: 'admin' | 'member'; storeIds: Set<string>; skus: Set<string>; }
export function filterVisibleItems(items: ItemRecord[], visibility: Visibility): ItemRecord[] { if (visibility.role === 'admin') return items; return items.filter((item) => visibility.storeIds.has(item.storeId) || visibility.skus.has(item.sku)); }
export function itemsRouter(list: (storeId?: string) => Promise<ItemRecord[]> = async () => []): Router {
  const r = Router();
  r.get('/items', async (req, res, next) => { try { const data = await list(typeof req.query.storeId === 'string' ? req.query.storeId : undefined); return res.json({ requestId: res.locals.requestId, data, error: null }); } catch (e) { return next(e); } });
  return r;
}
