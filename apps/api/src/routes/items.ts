import {latestItemReportFields} from '../../../../packages/db/src/normalization/item-report.js';
import { Router } from 'express';
import { and, createDb, eq, skus, smartSheetAllSkuRows, stores, users } from '@walmart-erp/db';
import { buildAllSkuChineseNameMap, buildAllSkuOwnerMap } from './allskuOwnerMapping.js';
export interface ItemRecord { id: string; storeId: string; sku: string; title?: string; chineseName?: string; itemId?: string; description?: string; brand?: string; productType?: string; lifecycleStatus?: string; publishedStatus?: string; availability?: string; gtin?: string; variantGroupId?: string; imageUrl?: string; isDuplicate?: boolean; isCustomerFavorite?: boolean; details?: unknown; reportFields?: Record<string, string>; updatedAt?: string | Date; ownerId?: string | null; ownerName?: string | null; }
export interface Visibility { tenantId?: string; role: 'admin' | 'member'; storeIds: Set<string>; skus: Set<string>; }
export interface ItemSnapshot { feedStatus?: string; lastSyncAt?: string | Date | null; }
export function filterVisibleItems(items: ItemRecord[], visibility: Visibility): ItemRecord[] { if (visibility.role === 'admin') return items; return items.filter((item) => visibility.storeIds.has(item.storeId) || visibility.skus.has(`${item.storeId}:${item.sku}`)); }
export function filterAssignedItems(items: ItemRecord[]): ItemRecord[] { return items.filter((item) => Boolean(item.ownerName?.trim() || item.ownerId?.trim())); }
export function itemReportFields(details: unknown): Record<string, string> | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const report = (details as Record<string, unknown>).itemReport;
  if (!report || typeof report !== 'object' || Array.isArray(report)) return undefined;
  return Object.fromEntries(Object.entries(report as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}
export function itemReportItemId(details: unknown): string | undefined {
  const fields = itemReportFields(details);
  return fields?.['Item ID']?.trim() || fields?.['Item Id']?.trim() || fields?.['Product ID']?.trim() || fields?.['Product Id']?.trim() || undefined;
}
export function itemIdFromSources(itemId: string | null | undefined, details: unknown): string | undefined {
  return itemId?.trim() || itemReportItemId(details);
}
export function itemResponseRecord<T extends object>(item: T): Omit<T, 'details'> {
  const { details: _details, ...response } = item as T & { details?: unknown };
  return response;
}
export function mysqlItemsSource(): (tenantId: string, storeId?: string) => Promise<ItemRecord[]> {
  return async (tenantId, storeId) => {
    const { db, pool } = createDb();
    try {
      const conditions = storeId ? and(eq(skus.tenantId, tenantId), eq(skus.storeId, storeId)) : eq(skus.tenantId, tenantId);
      const [rows, catalog, sourceRows, tenantStores, members, normalizedReports] = await Promise.all([
        db.select({ id: skus.id, storeId: skus.storeId, sku: skus.externalId, title: skus.title, itemId: skus.itemId, description: skus.description, brand: skus.brand, productType: skus.productType, lifecycleStatus: skus.lifecycleStatus, publishedStatus: skus.publishedStatus, availability: skus.availability, gtin: skus.gtin, variantGroupId: skus.variantGroupId, imageUrl: skus.imageUrl, isDuplicate: skus.isDuplicate, isCustomerFavorite: skus.isCustomerFavorite, updatedAt: skus.updatedAt }).from(skus).where(conditions),
        db.select({ id: skus.id, storeId: skus.storeId, externalId: skus.externalId }).from(skus).where(eq(skus.tenantId, tenantId)),
        db.select({ sku: smartSheetAllSkuRows.sku, storeName: smartSheetAllSkuRows.storeName, productName: smartSheetAllSkuRows.productName, ownerName: smartSheetAllSkuRows.ownerName }).from(smartSheetAllSkuRows).where(eq(smartSheetAllSkuRows.tenantId, tenantId)),
        db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.tenantId, tenantId)),
        db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.tenantId, tenantId)),
        latestItemReportFields(pool,tenantId,storeId),
      ]);
      const ownerMap = buildAllSkuOwnerMap(sourceRows, tenantStores, catalog, members);
      const chineseNames = buildAllSkuChineseNameMap(sourceRows, tenantStores);
      return filterAssignedItems(rows.map((row) => { const reportFields = normalizedReports.get(`${row.storeId}:${row.sku.trim().toUpperCase()}`); return itemResponseRecord({ ...row, chineseName: chineseNames.get(`${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`), ownerName: ownerMap.get(`${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`)?.ownerName ?? null, title: row.title ?? reportFields?.['Product Name'] ?? undefined, itemId: row.itemId?.trim() || reportFields?.['Item ID'] || reportFields?.['Product ID'] || undefined, description: row.description ?? undefined, brand: row.brand ?? reportFields?.Brand ?? undefined, productType: row.productType ?? undefined, lifecycleStatus: row.lifecycleStatus ?? undefined, publishedStatus: row.publishedStatus ?? reportFields?.['Publish Status'] ?? undefined, availability: row.availability ?? undefined, gtin: row.gtin ?? undefined, variantGroupId: row.variantGroupId ?? undefined, imageUrl: row.imageUrl ?? reportFields?.['Primary Image URL'] ?? undefined, isDuplicate: row.isDuplicate ?? undefined, isCustomerFavorite: row.isCustomerFavorite ?? undefined, reportFields }); }));
    } finally { await pool.end(); }
  };
}

export interface ItemsRouterOptions { list?: (tenantId: string, storeId?: string) => Promise<ItemRecord[]>; get?: (id: string) => Promise<ItemRecord | undefined>; visibility: (req: unknown) => Visibility | Promise<Visibility | undefined>; snapshot?: (storeId?: string) => Promise<ItemSnapshot>; }
export function itemsRouter(listOrOptions: ((storeId?: string) => Promise<ItemRecord[]>) | ItemsRouterOptions = async () => []): Router {
  const options: ItemsRouterOptions = typeof listOrOptions === 'function' ? { list: async (_tenantId: string, _storeId?: string) => listOrOptions(_storeId), visibility: () => Promise.resolve(undefined) } : listOrOptions;
  const list = options.list ?? (async () => []);
  const r = Router();
  r.get('/items', async (req, res, next) => { try { const visibility = await options.visibility(req); if (!visibility) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } }); const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined; const rows = await list(visibility.tenantId ?? '', storeId); const data = filterVisibleItems(rows, visibility); const meta = options.snapshot ? await options.snapshot(storeId) : {}; return res.json({ requestId: res.locals.requestId, data, meta, error: null }); } catch (e) { return next(e); } });
  r.get('/items/:id', async (req, res, next) => { try { const visibility = await options.visibility(req); if (!visibility) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } }); const found = options.get ? await options.get(req.params.id) : (await list(visibility.tenantId ?? '')).find((item) => item.id === req.params.id); if (!found || filterVisibleItems([found], visibility).length === 0) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Item not found' } }); return res.json({ requestId: res.locals.requestId, data: found, error: null }); } catch (e) { return next(e); } });
  return r;
}
