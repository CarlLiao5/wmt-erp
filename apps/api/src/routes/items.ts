import { Router } from 'express';
export interface ItemRecord { id: string; storeId: string; sku: string; title?: string; itemId?: string; updatedAt?: string | Date; ownerId?: string | null; }
export interface Visibility { role: 'admin' | 'member'; storeIds: Set<string>; skus: Set<string>; }
export interface ItemSnapshot { feedStatus?: string; lastSyncAt?: string | Date | null; }
export function filterVisibleItems(items: ItemRecord[], visibility: Visibility): ItemRecord[] { if (visibility.role === 'admin') return items; return items.filter((item) => visibility.storeIds.has(item.storeId) || visibility.skus.has(item.sku)); }
export interface ItemsRouterOptions { list?: (storeId?: string) => Promise<ItemRecord[]>; get?: (id: string) => Promise<ItemRecord | undefined>; visibility: (req: unknown) => Visibility; snapshot?: (storeId?: string) => Promise<ItemSnapshot>; }
export function itemsRouter(listOrOptions: ((storeId?: string) => Promise<ItemRecord[]>) | ItemsRouterOptions = async () => []): Router {
  const options: ItemsRouterOptions = typeof listOrOptions === 'function' ? { list: listOrOptions, visibility: () => ({ role: 'admin', storeIds: new Set(), skus: new Set() }) } : listOrOptions;
  const list = options.list ?? (async () => []);
  const r = Router();
  r.get('/items', async (req, res, next) => { try { const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined; const visibility = options.visibility(req); const rows = await list(storeId); const data = filterVisibleItems(rows, visibility); const meta = options.snapshot ? await options.snapshot(storeId) : {}; return res.json({ requestId: res.locals.requestId, data, meta, error: null }); } catch (e) { return next(e); } });
  r.get('/items/:id', async (req, res, next) => { try { const found = options.get ? await options.get(req.params.id) : (await list()).find((item) => item.id === req.params.id); if (!found || filterVisibleItems([found], options.visibility(req)).length === 0) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Item not found' } }); return res.json({ requestId: res.locals.requestId, data: found, error: null }); } catch (e) { return next(e); } });
  return r;
}
