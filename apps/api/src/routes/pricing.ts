import { Router, type Request } from 'express';
import { and, createDb, eq, gte, lte, sql, priceSnapshots } from '@walmart-erp/db';
import { requestSession } from './auth.js';
import type { OrderVisibility } from './orders.js';
import { canViewStore, filterVisibleSkuRows } from './sku-visibility.js';
export interface PricingListOptions { list?: (tenantId: string, storeId?: string, from?: string, to?: string, priceType?: string) => Promise<unknown[]>; visibility?: (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined; productImages?: (tenantId: string, products: Array<{ storeId: string; sku: string }>) => Promise<Map<string, string>>; }
export function pricingDateCondition(from: Date, to?: Date) {
  return sql`((${priceSnapshots.effectiveAt} >= ${from} ${to ? sql`AND ${priceSnapshots.effectiveAt} <= ${to}` : sql``}) OR (${priceSnapshots.effectiveAt} IS NULL AND ${priceSnapshots.receivedAt} >= ${from} ${to ? sql`AND ${priceSnapshots.receivedAt} <= ${to}` : sql``}))`;
}
export function mysqlPricingSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string, priceType?: string) => { const { db, pool } = createDb(); try { const cutoff = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); const end = to ? new Date(`${to}T23:59:59.999Z`) : undefined; const conditions = [eq(priceSnapshots.tenantId, tenantId), ...(storeId ? [eq(priceSnapshots.storeId, storeId)] : []), ...(priceType ? [eq(priceSnapshots.priceType, priceType)] : []), pricingDateCondition(cutoff, end)]; return await db.select({ id: priceSnapshots.id, tenantId: priceSnapshots.tenantId, storeId: priceSnapshots.storeId, sku: priceSnapshots.sku, price: priceSnapshots.price, targetPrice: priceSnapshots.targetPrice, buyBoxBasePrice: priceSnapshots.buyBoxBasePrice, buyBoxTotalPrice: priceSnapshots.buyBoxTotalPrice, comparisonPrice: priceSnapshots.comparisonPrice, competitorPrice: priceSnapshots.competitorPrice, currency: priceSnapshots.currency, priceType: priceSnapshots.priceType, promotion: priceSnapshots.promotion, promotionType: priceSnapshots.promotionType, showStrikethrough: priceSnapshots.showStrikethrough, incentiveType: priceSnapshots.incentiveType, incentiveStatus: priceSnapshots.incentiveStatus, incentiveId: priceSnapshots.incentiveId, startDate: priceSnapshots.startDate, endDate: priceSnapshots.endDate, effectiveAt: priceSnapshots.effectiveAt, sourceId: priceSnapshots.sourceId, receivedAt: priceSnapshots.receivedAt }).from(priceSnapshots).where(and(...conditions)); } finally { await pool.end(); } }; }
export function pricingRouter(options: PricingListOptions = {}): Router {
  const r = Router();
  r.get('/pricing', async (req, res, next) => {
    try {
      const session = await requestSession(req);
      if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
      const scope = options.visibility ? await options.visibility(req) : undefined;
      if (!scope) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      if (storeId && scope.role !== 'admin' && !canViewStore(scope, storeId)) return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } });
      const rows = await (options.list ?? mysqlPricingSource())(session.tenantId, storeId, typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined, typeof req.query.priceType === 'string' ? req.query.priceType : undefined);
      const typedRows = scope.role === 'admin' ? rows as any[] : filterVisibleSkuRows(rows as Array<{ storeId: string; sku: string }>, scope) as any[];
      const imageProducts = [...new Map(typedRows.map((row) => { const store = String(row.storeId ?? ''); const sku = String(row.sku ?? ''); return [`${store}:${sku.trim().toLocaleUpperCase('en-US')}`, { storeId: store, sku }]; })).values()];
      const images = options.productImages ? await options.productImages(session.tenantId, imageProducts) : new Map<string, string>();
      const rowsWithImages = typedRows.map((row) => ({ ...row, imageUrl: images.get(`${row.storeId}:${String(row.sku ?? '').trim().toLocaleUpperCase('en-US')}`) ?? row.imageUrl }));
      return res.json({ requestId: res.locals.requestId, data: { rows: rowsWithImages, dataAvailable: rowsWithImages.length > 0, source: 'walmart', lastSyncedAt: rowsWithImages.length ? rowsWithImages.reduce((max: string | Date, row: any) => new Date(row.receivedAt) > new Date(max) ? row.receivedAt : max, rowsWithImages[0].receivedAt) : null }, error: null });
    } catch (e) { return next(e); }
  });
  return r;
}
