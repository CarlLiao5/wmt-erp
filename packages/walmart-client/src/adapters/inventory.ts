import type { WalmartConnection } from '../types.js';
import { walmartGet } from '../transport.js';
export async function* getInventory(c: WalmartConnection, q: Record<string,string>={}) { let cursor=q.nextCursor; do { const response=await walmartGet<any>(c,'/v3/inventories',{query:{...q,...(cursor?{nextCursor:cursor}:{})}}); const payload=response.data?.elements?.inventories ?? response.data?.payload?.inventory ?? []; for(const item of Array.isArray(payload)?payload:[]) yield item; cursor=response.data?.meta?.nextCursor; } while(cursor); }

/** Seller fulfillment inventory is used only for WFS ship-node quantities. */
export async function* getFulfillmentInventory(c: WalmartConnection, q: Record<string,string>={}, fetcher?: typeof fetch) {
  let cursor=q.nextCursor;
  do {
    const response=await walmartGet<any>(c,'/v3/fulfillment/inventory',{query:{...q,...(cursor?{nextCursor:cursor}:{})}, fetcher});
    const payload=response.data?.elements?.inventories ?? response.data?.payload?.inventory ?? response.data?.inventory ?? [];
    for (const item of Array.isArray(payload)?payload:[]) yield item;
    cursor=response.data?.meta?.nextCursor ?? response.data?.list?.meta?.nextCursor;
  } while(cursor);
}


export async function* getInventoryHealth(c: WalmartConnection, q: Record<string,string>={}, fetcher?: typeof fetch) { let offset=Number(q.offset??0); const limit=Number(q.limit??200); do { const response=await walmartGet<any>(c,'/v3/wfs/inventory',{query:{...q,offset:String(offset),limit:String(limit)},fetcher}); const payload=response.data?.payload??response.data; const items=Array.isArray(payload?.inventory)?payload.inventory:[]; for(const item of items) yield item; const total=Number(response.data?.headers?.totalCount??items.length); offset+=items.length; if(!items.length||offset>=total) break; } while(true); }

export const MAX_WFS_INVENTORY_LOG_DAYS = 365;
export interface WfsInventoryLogQuery { gtin: string; startDate?: string; endDate?: string; offset?: number; limit?: number; }
export interface WfsInventoryLogPage { payload?: { inventoryLog?: unknown[] }; inventoryLog?: unknown[]; nextOffset?: number; }
export async function listWfsInventoryLog(connection: WalmartConnection, input: WfsInventoryLogQuery, fetcher?: typeof fetch) {
  if (!input.gtin.trim()) throw new Error('WFS inventory log requires gtin');
  if (input.startDate && input.endDate) {
    const from = Date.parse(`${input.startDate}T00:00:00Z`);
    const to = Date.parse(`${input.endDate}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('Invalid WFS inventory log date range');
    if ((to - from) / 86_400_000 > MAX_WFS_INVENTORY_LOG_DAYS) throw new Error(`WFS inventory log direct API supports at most ${MAX_WFS_INVENTORY_LOG_DAYS} days`);
  }
  const limit = Math.min(50, Math.max(1, input.limit ?? 50));
  return walmartGet<WfsInventoryLogPage>(connection, '/v3/fulfillment/inventory-log', { query: { gtin: input.gtin, ...(input.startDate ? { startDate: input.startDate } : {}), ...(input.endDate ? { endDate: input.endDate } : {}), offset: String(Math.max(0, input.offset ?? 0)), limit: String(limit) }, fetcher });
}
