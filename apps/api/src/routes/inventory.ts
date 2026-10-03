import { Router } from 'express';
export interface InventoryRow { storeId: string; sku: string; quantity: number; updatedAt: string; }
export function inventoryAge(updatedAt: string, now = new Date()): number { return Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 86400000)); }
export function reconcileInventory(expected: InventoryRow[], actual: InventoryRow[]) { const a = new Map(actual.map((x) => [`${x.storeId}:${x.sku}`, x.quantity])); return expected.map((x) => ({ ...x, delta: (a.get(`${x.storeId}:${x.sku}`) ?? 0) - x.quantity })); }
export function inventoryRouter(list: () => Promise<InventoryRow[]> = async () => []): Router { const r = Router(); r.get('/inventory', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: await list(), error: null }); } catch (e) { return next(e); } }); return r; }
