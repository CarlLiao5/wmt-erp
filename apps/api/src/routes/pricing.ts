import { Router, type Request } from 'express';
import { and, createDb, eq, gte, lte, sql, priceSnapshots } from '@walmart-erp/db';
import { requestSession } from './auth.js';
import type { OrderVisibility } from './orders.js';
import { canViewStore, filterVisibleSkuRows } from './sku-visibility.js';
import { filterAndSortPricing, filterPricingByType, paginatePricing } from './pricingGroups.js';
const queryFlag = (req: Request, name: string) => {
  const value = req.query[name];
  return typeof value === 'string' && ['yes', 'no', 'unknown', 'all'].includes(value) ? value : undefined;
};
export interface PricingListOptions { list?: (tenantId: string, storeId?: string, from?: string, to?: string, priceType?: string, latestOnly?: boolean) => Promise<unknown[]>; visibility?: (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined; productImages?: (tenantId: string, products: Array<{ storeId: string; sku: string }>) => Promise<Map<string, string>>; }
export function pricingDateCondition(from: Date, to?: Date) {
  return sql`((${priceSnapshots.effectiveAt} >= ${from} ${to ? sql`AND ${priceSnapshots.effectiveAt} <= ${to}` : sql``}) OR (${priceSnapshots.effectiveAt} IS NULL AND ${priceSnapshots.receivedAt} >= ${from} ${to ? sql`AND ${priceSnapshots.receivedAt} <= ${to}` : sql``}))`;
}
// Explicit columns matter: selecting ps.* materialises the wide payload columns and takes tens of seconds on this table.
const LATEST_COLUMNS = sql.raw('id, tenant_id, store_id, sku, price, target_price, buy_box_base_price, buy_box_total_price, comparison_price, competitor_price, currency, promotion_type, show_strikethrough, incentive_type, incentive_status, start_date, end_date, received_at');
// One row per store + SKU: latest base price, latest incentive, and the newest promotion that is active right now.
export function latestPricingQuery(tenantId: string, cutoff: Date, end: Date | undefined, storeId?: string, priceType?: string, now = new Date()) {
  const inWindow = sql`((effective_at >= ${cutoff} ${end ? sql`AND effective_at <= ${end}` : sql``}) OR (effective_at IS NULL AND received_at >= ${cutoff} ${end ? sql`AND received_at <= ${end}` : sql``}))`;
  const scope = sql`tenant_id = ${tenantId} ${storeId ? sql`AND store_id = ${storeId}` : sql``}`;
  const latestOf = (filter: any) => sql`(SELECT * FROM (SELECT ${LATEST_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY store_id, UPPER(sku) ORDER BY COALESCE(received_at, effective_at) DESC, id DESC) AS seq FROM price_snapshots WHERE ${scope} AND ${filter} AND ${inWindow}) ranked WHERE seq = 1)`;
  return sql`SELECT base.id, base.tenant_id AS tenantId, base.store_id AS storeId, base.sku, base.price AS currentPrice, base.target_price AS targetPrice, base.buy_box_base_price AS buyBoxBasePrice, base.buy_box_total_price AS buyBoxTotalPrice, base.comparison_price AS comparisonPrice, base.competitor_price AS competitorPrice, base.currency, incentive.target_price AS incentiveTargetPrice, incentive.incentive_type AS incentiveType, incentive.incentive_status AS incentiveStatus, promo.price AS promotionPrice, promo.promotion_type AS promotionType, promo.start_date AS promotionStart, promo.end_date AS promotionEnd, promo.show_strikethrough AS showStrikethrough, base.received_at AS receivedAt FROM ${latestOf(sql`price_type <> 'promotion' ${priceType && priceType !== 'promotion' ? sql`AND price_type = ${priceType}` : sql``}`)} base LEFT JOIN ${latestOf(sql`price_type = 'incentive'`)} incentive ON base.store_id = incentive.store_id AND UPPER(base.sku) = UPPER(incentive.sku) LEFT JOIN ${latestOf(sql`price_type = 'promotion' AND (start_date IS NULL OR start_date <= ${now}) AND (end_date IS NULL OR end_date >= ${now})`)} promo ON base.store_id = promo.store_id AND UPPER(base.sku) = UPPER(promo.sku)`;
}
export function mysqlPricingSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string, priceType?: string, latestOnly = false) => { const { db, pool } = createDb(); try { const cutoff = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); const end = to ? new Date(`${to}T23:59:59.999Z`) : undefined; if (latestOnly) { const result = await db.execute(latestPricingQuery(tenantId, cutoff, end, storeId)) as unknown as [unknown[]]; const rows = (result[0] as any[]).map(r => ({ id: r.id, tenantId: r.tenantId, storeId: r.storeId, sku: r.sku, currentPrice: r.currentPrice, targetPrice: r.incentiveTargetPrice ?? r.targetPrice, buyBoxBasePrice: r.buyBoxBasePrice, buyBoxTotalPrice: r.buyBoxTotalPrice, comparisonPrice: r.comparisonPrice, competitorPrice: r.competitorPrice, currency: r.currency, priceType: 'base', promotionType: r.promotionType ?? null, showStrikethrough: r.showStrikethrough ?? null, incentiveType: r.incentiveType ?? null, incentiveStatus: r.incentiveStatus ?? null, promotionPrice: r.promotionPrice ?? null, promotionStart: r.promotionStart ?? null, promotionEnd: r.promotionEnd ?? null, receivedAt: r.receivedAt })); return filterPricingByType(rows, priceType); } const conditions = [eq(priceSnapshots.tenantId, tenantId), ...(storeId ? [eq(priceSnapshots.storeId, storeId)] : []), ...(priceType ? [eq(priceSnapshots.priceType, priceType)] : []), pricingDateCondition(cutoff, end)]; return await db.select({ id: priceSnapshots.id, tenantId: priceSnapshots.tenantId, storeId: priceSnapshots.storeId, sku: priceSnapshots.sku, price: priceSnapshots.price, targetPrice: priceSnapshots.targetPrice, buyBoxBasePrice: priceSnapshots.buyBoxBasePrice, buyBoxTotalPrice: priceSnapshots.buyBoxTotalPrice, comparisonPrice: priceSnapshots.comparisonPrice, competitorPrice: priceSnapshots.competitorPrice, currency: priceSnapshots.currency, priceType: priceSnapshots.priceType, promotion: priceSnapshots.promotion, promotionType: priceSnapshots.promotionType, showStrikethrough: priceSnapshots.showStrikethrough, incentiveType: priceSnapshots.incentiveType, incentiveStatus: priceSnapshots.incentiveStatus, incentiveId: priceSnapshots.incentiveId, startDate: priceSnapshots.startDate, endDate: priceSnapshots.endDate, effectiveAt: priceSnapshots.effectiveAt, sourceId: priceSnapshots.sourceId, receivedAt: priceSnapshots.receivedAt }).from(priceSnapshots).where(and(...conditions)); } finally { await pool.end(); } }; }
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
      const rows = await (options.list ?? mysqlPricingSource())(session.tenantId, storeId, typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined, typeof req.query.priceType === 'string' ? req.query.priceType : undefined, req.query.view === 'summary');
      const typedRows = scope.role === 'admin' ? rows as any[] : filterVisibleSkuRows(rows as Array<{ storeId: string; sku: string }>, scope) as any[];
      // view=summary: each SKU is merged per SQL already, just paginate and fetch images for the page.
      const summary = req.query.view === 'summary';
      const lastSynced = (list: any[]) => list.length ? list.reduce((max: string | Date, row: any) => new Date(row.receivedAt ?? row.effectiveAt ?? Date.now()) > new Date(max) ? row.receivedAt ?? row.effectiveAt ?? Date.now() : max, list[0].receivedAt ?? list[0].effectiveAt ?? Date.now()) : null;
      const paged = summary ? paginatePricing(filterAndSortPricing(typedRows, queryFlag(req, 'promotion'), queryFlag(req, 'strikethrough')), req.query.page, req.query.pageSize) : undefined;
      const sourceRows = paged ? paged.rows as any[] : typedRows;
      const imageProducts = [...new Map(sourceRows.map((row) => { const store = String(row.storeId ?? ''); const sku = String(row.sku ?? ''); return [`${store}:${sku.trim().toLocaleUpperCase('en-US')}`, { storeId: store, sku }]; })).values()];
      const images = options.productImages ? await options.productImages(session.tenantId, imageProducts) : new Map<string, string>();
      const rowsWithImages = sourceRows.map((row) => ({ ...row, imageUrl: images.get(`${row.storeId}:${String(row.sku ?? '').trim().toLocaleUpperCase('en-US')}`) ?? row.imageUrl }));
      if (paged) return res.json({ requestId: res.locals.requestId, data: { rows: rowsWithImages, page: paged.page, pageSize: paged.pageSize, pages: paged.pages, total: paged.total, dataAvailable: paged.total > 0, source: 'walmart', lastSyncedAt: lastSynced(typedRows) }, error: null });
      return res.json({ requestId: res.locals.requestId, data: { rows: rowsWithImages, dataAvailable: rowsWithImages.length > 0, source: 'walmart', lastSyncedAt: lastSynced(rowsWithImages) }, error: null });
    } catch (e) { return next(e); }
  });
  return r;
}
