import { Router, type Request } from 'express';
import { and, createDb, eq, smartSheetAllSkuRows, stores } from '@walmart-erp/db';
import { reconcileReturnPayments } from './return-reconciliation.js';
import { filterVisibleSkuRows } from './sku-visibility.js';
import { returnReconciliationWorkbook } from './return-reconciliation-export.js';
import { buildAllSkuChineseNameMap } from './allskuOwnerMapping.js';
import type { OrderVisibility } from './orders.js';
import { returnRateOrderDateRange, todayPacificDate, type CommerceQuery, type ReturnPageQuery, type ReturnPageResult } from './commerce-source.js';
import { dateRangeError } from './date-range.js';
import type { ProductImageKey } from './product-images.js';
import { filterVisibleOrderLines, pacificOrderTime, type OrderLine } from './orders.js';
import { createTtlCache } from './product-rate-cache.js';
export interface ReturnRecord { id: string; returnId?: string; tenantId?: string; orderId: string; orderNumber?: string; itemId?: string; storeId: string; sku: string; imageUrl?: string; status: string; amount?: number | null; reason?: string; reasonCode?: string; refundCoveredBy?: string; refundChannelCoveredBy?: string; isReturnForException?: boolean; returnChannelName?: string; returnedAt?: string | null; }
export function filterVisibleReturns(rows: ReturnRecord[], storeIds: Set<string>, role: 'admin' | 'member') { return role === 'admin' ? rows : rows.filter((r) => storeIds.has(r.storeId)); }
export function isSellerAttributedReturn(row: ReturnRecord) {
  const owner = row.refundCoveredBy?.trim().toUpperCase();
  return owner === 'SELLER' || owner === 'SELLER KEEP-IT';
}
function returnResponsibilityLabel(owner?: string) {
  const value = owner?.trim().toUpperCase();
  if (value === 'SELLER' || value === 'SELLER KEEP-IT') return '卖家责任';
  if (value === 'WALMART' || value === 'WALMART KEEP-IT') return 'WFS责任';
  return '其他/未提供';
}
export interface ReturnHistoryRecord { id: string; returnId: string; status: string; refundAmount?: number; returnedAt?: string; rawResponseId: string; }
export interface ReturnsRouterOptions { list: (tenantId: string, query?: CommerceQuery) => Promise<ReturnRecord[]>; listPage?: (tenantId: string, query: ReturnPageQuery) => Promise<ReturnPageResult>; visibility: (req: Request) => OrderVisibility | Promise<OrderVisibility | undefined> | undefined; orders?: (tenantId: string, query?: CommerceQuery) => Promise<OrderLine[]>; history?: (tenantId: string, query?: CommerceQuery & { returnId?: string; storeIds?: string[]; skuScopes?: { storeId: string; sku: string }[] }) => Promise<ReturnHistoryRecord[]>; productImages?: (tenantId: string, products: ProductImageKey[]) => Promise<Map<string, string>>; productChineseNames?: (tenantId: string, products: ProductImageKey[]) => Promise<Map<string, string>>; }

export function mysqlProductChineseNameResolver() {
  const { db } = createDb();
  const tenantNameCache = createTtlCache<string, Map<string, string>>({ ttlMs: 60_000, maxEntries: 24 });
  return async (tenantId: string, products: ProductImageKey[]) => {
    if (!products.length) return new Map<string, string>();
    const names = await tenantNameCache.getOrLoad(tenantId, async () => {
      const [rows, tenantStores] = await Promise.all([
        db.select({ sku: smartSheetAllSkuRows.sku, storeName: smartSheetAllSkuRows.storeName, productName: smartSheetAllSkuRows.productName }).from(smartSheetAllSkuRows).where(eq(smartSheetAllSkuRows.tenantId, tenantId)),
        db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.tenantId, tenantId)),
      ]);
      return buildAllSkuChineseNameMap(rows, tenantStores);
    });
    return new Map(products.flatMap((product) => {
      const key = `${product.storeId}:${product.sku.trim().toLocaleUpperCase('en-US')}`;
      const name = names.get(key);
      return name ? [[key, name] as const] : [];
    }));
  };
}
export function returnsRouter(input: ReturnsRouterOptions | (() => Promise<ReturnRecord[]>) = async () => []): Router {
  const options: ReturnsRouterOptions = typeof input === 'function' ? { list: input, visibility: () => undefined } : input;
  const r = Router();
  const sourceQuery = (req: Request): CommerceQuery => ({ storeId: typeof req.query.storeId === 'string' ? req.query.storeId : undefined, from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined });
  const skuScopes = (v: OrderVisibility) => [...v.skus].map((scope) => { const separator = scope.indexOf(':'); return separator < 0 ? undefined : { storeId: scope.slice(0, separator), sku: scope.slice(separator + 1) }; }).filter((scope): scope is { storeId: string; sku: string } => Boolean(scope));
    const visible = async (req: Request, v: OrderVisibility) => (await options.list(v.tenantId!, sourceQuery(req))).filter((row) => row.tenantId === v.tenantId && (v.role === 'admin' || v.storeIds.has(row.storeId) || v.skus.has(`${row.storeId}:${row.sku}`)));
  r.get('/returns/reconciliation/export', async (req, res, next) => { try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const invalid = dateRangeError(from,to);
    if (invalid) return res.status(400).json({ error: { message: invalid } });
    const v = await options.visibility(req);
    if (!v?.tenantId) return res.status(401).json({ error: { message: 'Authenticated visibility scope required' } });
    if (!options.listPage) return res.status(503).json({ error: { message: '退货数据源未配置' } });
    const text = (key: string) => typeof req.query[key] === 'string' ? req.query[key] as string : undefined;
    const query: ReturnPageQuery = { ...sourceQuery(req), page: 1, pageSize: 100, sku: text('sku'), itemId: text('itemId'), orderNumber: text('orderNumber'), status: text('status'), ...(v.role === 'member' ? { storeIds: [...v.storeIds], skuScopes: skuScopes(v) } : {}) };
    const workbook = await returnReconciliationWorkbook(v.tenantId,query,options.listPage);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="wfs-debit-anomalies-${from ?? 'all'}-${to ?? 'all'}.xlsx"`);
    return res.send(workbook);
  } catch(e) { return next(e); } });
  r.get('/returns', async (req, res, next) => { try {
    const rangeError = dateRangeError(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (rangeError) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: rangeError } });
    const v = await options.visibility(req);
    if (!v?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    if (options.listPage) {
      const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
      const result = await options.listPage(v.tenantId, { ...sourceQuery(req), page, pageSize, sku: typeof req.query.sku === 'string' ? req.query.sku : undefined, itemId: typeof req.query.itemId === 'string' ? req.query.itemId : undefined, orderNumber: typeof req.query.orderNumber === 'string' ? req.query.orderNumber : undefined, status: typeof req.query.status === 'string' ? req.query.status : undefined, reason: typeof req.query.reason === 'string' ? req.query.reason : undefined, responsibility: req.query.view === 'reconciliation' || req.query.responsibility === 'wfs' ? 'wfs' : undefined, reconciliation: req.query.view === 'reconciliation', productRates: req.query.view === 'product-rates', sort: typeof req.query.sort === 'string' ? req.query.sort : undefined, direction: req.query.direction === 'asc' ? 'asc' : 'desc', ...(v.role === 'member' ? { storeIds: [...v.storeIds], skuScopes: skuScopes(v) } : {}) });
      const productRates = req.query.view === 'product-rates' ? filterVisibleSkuRows(result.productRates ?? [], v) : undefined;
      const productKeys = productRates?.map(({ storeId, sku }) => ({ storeId, sku })) ?? [];
      const [images, chineseNames] = await Promise.all([
        options.productImages && (req.query.view === undefined || productRates) ? options.productImages(v.tenantId, req.query.view === undefined ? result.rows : productKeys) : new Map<string, string>(),
        options.productChineseNames && productRates ? options.productChineseNames(v.tenantId, productKeys) : new Map<string, string>(),
      ]);
      const rows = result.rows.map((row) => ({ ...row, imageUrl: images.get(`${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`) ?? images.get(`sku:${row.sku.trim().toLocaleUpperCase('en-US')}`) ?? row.imageUrl }));
      const enrichedProductRates = productRates?.map((product) => {
        const key = `${product.storeId}:${product.sku.trim().toLocaleUpperCase('en-US')}`;
        return { ...product, imageUrl: images.get(key) ?? product.imageUrl, chineseName: chineseNames.get(key) ?? product.chineseName };
      });
      return res.json({ requestId: res.locals.requestId, data: { rows: req.query.view === 'reconciliation' ? await reconcileReturnPayments(v.tenantId, rows) : rows, total: result.total, page, pageSize, dateBasis: 'returnedAt', analytics: ['reconciliation','product-rates'].includes(String(req.query.view)) ? undefined : result.analytics, productRates: enrichedProductRates }, error: null });
    }
    const scopedRows = (await visible(req, v)).filter((row) => (typeof req.query.storeId !== 'string' || row.storeId === req.query.storeId) && (typeof req.query.sku !== 'string' || row.sku === req.query.sku) && (typeof req.query.orderNumber !== 'string' || row.orderNumber === req.query.orderNumber) && (typeof req.query.itemId !== 'string' || row.itemId === req.query.itemId) && (typeof req.query.status !== 'string' || row.status === req.query.status) && (typeof req.query.from !== 'string' || (row.returnedAt ?? '').slice(0, 10) >= req.query.from) && (typeof req.query.to !== 'string' || (row.returnedAt ?? '').slice(0, 10) <= req.query.to));
    const sellerRows = scopedRows.filter(isSellerAttributedReturn);
    const responsibilityCounts = new Map<string, number>();
    for (const row of scopedRows) {
      const responsibility = returnResponsibilityLabel(row.refundCoveredBy);
      responsibilityCounts.set(responsibility, (responsibilityCounts.get(responsibility) ?? 0) + 1);
    }
    const reasons = new Map<string, number>();
    for (const row of sellerRows) { const reason = row.reason || '未提供原因'; reasons.set(reason, (reasons.get(reason) ?? 0) + 1); }
    const selectedReason = typeof req.query.reason === 'string' ? req.query.reason : undefined;
    const rows = selectedReason ? sellerRows.filter((row) => (row.reason || '未提供原因') === selectedReason) : scopedRows;
    const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const today = todayPacificDate(); const month = today.slice(0,7);
    const todayRows = scopedRows.filter((row) => (row.returnedAt ?? '').slice(0,10) === today);
    const monthRows = scopedRows.filter((row) => (row.returnedAt ?? '').slice(0,7) === month);
    const sellerMonthRows = sellerRows.filter((row) => (row.returnedAt ?? '').slice(0,7) === month);
    const daily = new Map<string, number>();
    // Keep chart and trend populations independent of the selected reason so
    // the user can switch between causes without losing the full distribution.
    for (const row of scopedRows) { const day = (row.returnedAt ?? '').slice(0,10); if ((row.returnedAt ?? '').slice(0,7) === month && day) daily.set(day, (daily.get(day) ?? 0) + 1); }
    const productCounts = new Map<string, number>();
    for (const row of scopedRows) productCounts.set(row.sku, (productCounts.get(row.sku) ?? 0) + 1);
    const topProducts = [...productCounts].map(([sku, count]) => ({ sku, count }))
      .sort((a, b) => b.count - a.count || a.sku.localeCompare(b.sku)).slice(0, 20);
    const dailyTrend = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29-i)*86400000).toISOString().slice(0,10); return { date: d, count: daily.get(d) ?? 0 }; });
    const denominatorRange = returnRateOrderDateRange(sourceQuery(req), today);
    const monthOrders = options.orders && denominatorRange ? filterVisibleOrderLines(await options.orders(v.tenantId!, { ...sourceQuery(req), from: denominatorRange.from, to: denominatorRange.to }), v).filter((row) => { const date = row.orderedAt ? pacificOrderTime(row.orderedAt)?.date : undefined; return !!date && date >= denominatorRange.from && date <= denominatorRange.to && (typeof req.query.sku !== 'string' || row.sku === req.query.sku) && (typeof req.query.itemId !== 'string' || row.itemId === req.query.itemId) && (typeof req.query.orderNumber !== 'string' || row.orderNumber === req.query.orderNumber); }) : [];
    const orderedOrderCount = new Set(monthOrders.map((row) => row.orderId)).size;
    const returnedOrderCount = new Set(sellerMonthRows.map((row) => row.orderId)).size;
    const refundedRows = monthRows.filter((row) => row.status.toUpperCase() === 'REFUNDED');
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    const images = options.productImages ? await options.productImages(v.tenantId, pageRows) : new Map<string, string>();
    const rowsWithImages = pageRows.map((row) => ({ ...row, imageUrl: images.get(`${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`) ?? images.get(`sku:${row.sku.trim().toLocaleUpperCase('en-US')}`) ?? row.imageUrl }));
    return res.json({ requestId: res.locals.requestId, data: { rows: rowsWithImages, total: rows.length, page, pageSize, dateBasis: 'returnedAt', analytics: { todayNew: todayRows.length, monthReturnRate: orderedOrderCount ? returnedOrderCount / orderedOrderCount : null, returnedOrderCount, orderedOrderCount, monthRefundAmount: refundedRows.some((row) => row.amount == null) ? null : refundedRows.reduce((sum, row) => sum + row.amount!, 0), reasonDistribution: [...reasons].map(([reason,count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)), responsibilityDistribution: [...responsibilityCounts].map(([responsibility,count]) => ({ responsibility, count })), dailyTrend, topProducts } }, error: null });
  } catch (e) { return next(e); } });
  r.get('/returns/:id/history', async (req, res, next) => { try {
    const v = await options.visibility(req);
    if (!v?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    const authorizedReturn = options.listPage ? (await options.listPage(v.tenantId, { page: 1, pageSize: 1, returnId: req.params.id, ...(v.role === 'member' ? { storeIds: [...v.storeIds], skuScopes: skuScopes(v) } : {}) })).rows[0] : (await visible(req, v)).find((row) => row.id === req.params.id);
    if (!authorizedReturn) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Return not found' } });
    const history = options.history ? await options.history(v.tenantId, { returnId: req.params.id, storeId: authorizedReturn.storeId, ...(v.role === 'member' ? { storeIds: [...v.storeIds] } : {}) }) : [];
    return res.json({ requestId: res.locals.requestId, data: history.filter((snapshot) => snapshot.returnId === req.params.id), error: null });
  } catch (error) { return next(error); } });
  return r;
}
