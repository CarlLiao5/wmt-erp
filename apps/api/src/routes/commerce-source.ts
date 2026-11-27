import {orderLineExtensions} from '../../../../packages/db/src/normalization/order-extensions.js';
import { and, createDb, eq, gte, lte, sql, orders, orderLines, skus, returnRecords, returnStatusEvents } from '@walmart-erp/db';
import { normalizeOrderPayload } from '../../../worker/src/jobs/syncOrders.js';
import { normalizeReturnPayload } from '../../../worker/src/jobs/syncReturns.js';
import type { OrderLine } from './orders.js';
import type { ReturnRecord } from './returns.js';
import { wfsDebitExistsSql } from './return-reconciliation.js';
import { createTtlCache } from './product-rate-cache.js';
import { isCancelledOrderStatus } from '../../../../packages/domain/src/orderStatus.js';

export interface RawCommerceRow { id: string | number; externalId?: string; tenantId: string; storeId: string; resource: string; payload: unknown; }
export interface ReturnSnapshot { id: string; returnId: string; status: string; refundAmount?: number; returnedAt?: string; rawResponseId: string; }
export interface CommerceQuery { storeId?: string; from?: string; to?: string; sku?: string; orderedAtOrAfter?: Date; }
export interface CommerceScopeQuery { storeIds?: string[]; skuScopes?: { storeId: string; sku: string }[]; }
export interface OrderPageQuery extends CommerceQuery, CommerceScopeQuery { page: number; pageSize: number; sku?: string; itemId?: string; orderNumber?: string; status?: string; salesView?: boolean; }
export interface ReturnPageQuery extends CommerceQuery, CommerceScopeQuery { page: number; pageSize: number; sku?: string; itemId?: string; orderNumber?: string; status?: string; reason?: string; returnId?: string; responsibility?: string; reconciliation?: boolean; productRates?: boolean; sort?: string; direction?: 'asc' | 'desc'; }
export interface ReturnPageResult { rows: ReturnRecord[]; total: number; analytics: { todayNew: number; monthReturnRate: number | null; returnedOrderCount: number; orderedOrderCount: number; monthRefundAmount: number | null; reasonDistribution: { reason: string; count: number }[]; responsibilityDistribution: { responsibility: string; count: number }[]; dailyTrend: { date: string; count: number }[]; topProducts: { sku: string; count: number }[] }; productRates?: { sku: string; storeId: string; productName?: string; chineseName?: string; imageUrl?: string; orderCount: number; returnedOrderCount: number; returnRate: number | null }[]; }
const reasonLabels: Record<string, string> = {
  NO_LONGER_WANTED: 'No Longer Wanted',
  DEFECTIVE: 'Defective/Broken',
  NOT_AS_DESCRIBED_PICTURED: 'Not as described/pictured',
  UNABLE_TO_DELIVER: 'Unable to deliver',
  LOST_IN_TRANSIT: 'Lost in Transit',
  LOST_AFTER_DELIVERY: 'Lost After Delivery',
  INCORRECT_ITEM: 'Incorrect item received',
};
export function normalizeReturnReason(reasonCode?: string, reason?: string) {
  const rawCode = reasonCode?.trim().toUpperCase();
  const fallback = reason?.trim() || '未提供原因';
  const key = rawCode || fallback.toUpperCase().replace(/[\s/-]+/g, '_');
  const known = reasonLabels[key];
  return { key, label: known ?? fallback };
}
function sellerReturnFilterSql(alias = 'rr') {
  return `UPPER(TRIM(COALESCE(${alias}.refund_covered_by, ''))) IN ('SELLER', 'SELLER KEEP-IT')`;
}
function returnReasonKeySql(alias = 'rr') {
  return `COALESCE(NULLIF(UPPER(TRIM(${alias}.reason_code)), ''), NULLIF(UPPER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(${alias}.reason, '')), ' ', '_'), '/', '_'), '-', '_')), ''), 'UNSPECIFIED')`;
}
function returnReasonLabelSql(alias = 'rr') {
  const key = returnReasonKeySql(alias);
  return `CASE ${key} WHEN 'NO_LONGER_WANTED' THEN 'No Longer Wanted' WHEN 'DEFECTIVE' THEN 'Defective/Broken' WHEN 'NOT_AS_DESCRIBED_PICTURED' THEN 'Not as described/pictured' WHEN 'UNABLE_TO_DELIVER' THEN 'Unable to deliver' WHEN 'LOST_IN_TRANSIT' THEN 'Lost in Transit' WHEN 'LOST_AFTER_DELIVERY' THEN 'Lost After Delivery' WHEN 'INCORRECT_ITEM' THEN 'Incorrect item received' WHEN 'UNSPECIFIED' THEN '未提供原因' ELSE COALESCE(NULLIF(TRIM(${alias}.reason), ''), '未提供原因') END`;
}
export interface OrderSalesSkuRow { storeId: string; sku: string; itemId?: string; units: number | null; orders: number; revenue: number | null; }
export function aggregateOrderSalesBySku(lines: Array<Pick<OrderLine, 'orderId' | 'storeId' | 'sku' | 'itemId' | 'quantity' | 'amount' | 'status'>>): OrderSalesSkuRow[] {
  const groups = new Map<string, { storeId: string; sku: string; itemId?: string; units: number; orders: Set<string>; revenue: number; unitsComplete: boolean; revenueComplete: boolean }>();
  for (const line of lines) {
    if (isCancelledOrderStatus(line.status)) continue;
    const key = `${line.storeId}\u0000${line.sku}\u0000${line.itemId ?? ''}`;
    const group = groups.get(key) ?? { storeId: line.storeId, sku: line.sku, itemId: line.itemId, units: 0, orders: new Set<string>(), revenue: 0, unitsComplete: true, revenueComplete: true };
    group.orders.add(line.orderId);
    if (line.quantity == null) group.unitsComplete = false; else group.units += Number(line.quantity);
    if (line.amount == null) group.revenueComplete = false; else group.revenue += Number(line.amount);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ storeId: group.storeId, sku: group.sku, ...(group.itemId ? { itemId: group.itemId } : {}), units: group.unitsComplete ? group.units : null, orders: group.orders.size, revenue: group.revenueComplete ? group.revenue : null }))
    .sort((a, b) => (b.units ?? -1) - (a.units ?? -1) || b.orders - a.orders || a.sku.localeCompare(b.sku));
}
export interface CommerceSource { listOrders(tenantId: string, query?: CommerceQuery): Promise<OrderLine[]>; listOrdersPage?(tenantId: string, query: OrderPageQuery): Promise<{ rows: OrderLine[]; total: number; metrics: { orders: number; units: number | null; revenue: number | null }; dailyOrderTrend: { date: string; count: number }[]; hourlyOrderTrend: { hour: number; count: number }[]; chinaHourlyOrderTrend: { hour: number; count: number }[]; regionDistribution: { region: string; count: number }[]; salesBySku?: OrderSalesSkuRow[] }>; getOrderLines?(tenantId: string, orderId: string, scope?: CommerceScopeQuery): Promise<OrderLine[]>; listReturns(tenantId: string, query?: CommerceQuery): Promise<ReturnRecord[]>; listReturnsPage?(tenantId: string, query: ReturnPageQuery): Promise<ReturnPageResult>; listReturnSnapshots?(tenantId: string, query?: CommerceQuery & { returnId?: string; storeIds?: string[]; skuScopes?: { storeId: string; sku: string }[] }): Promise<ReturnSnapshot[]>; }
function addCalendarDays(value: string, days: number) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export function todayPacificDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftCalendarDays(value: string, days: number) { return addCalendarDays(value, days); }
export function returnRateOrderDateRange(query: { from?: string; to?: string }, today = todayPacificDate()) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = query.from && query.from > monthStart ? query.from : monthStart;
  const to = query.to && query.to < today ? query.to : today;
  return from <= to ? { from, to } : null;
}
function pacificMidnightUtc(value: string) {
  const target = new Date(`${value}T00:00:00.000Z`).getTime();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant = target - (represented - instant);
  }
  return new Date(instant);
}
export function pacificDateRangeBounds(from: string, to: string): [Date, Date] { return [pacificMidnightUtc(from), pacificMidnightUtc(addCalendarDays(to, 1))]; }
function pacificReturnDate(alias = 'rr') {
  const raw = `${alias}.returned_at`;
  return `COALESCE(DATE(CONVERT_TZ(STR_TO_DATE(REPLACE(LEFT(${raw}, 19), 'T', ' '), '%Y-%m-%d %H:%i:%s'), '+00:00', 'America/Los_Angeles')), LEFT(${raw}, 10))`;
}
function appendReturnFilters(filters: string[], params: unknown[], query: ReturnPageQuery) {
  if (query.storeId) { filters.push('rr.store_id = ?'); params.push(query.storeId); }
  if (query.from) { filters.push(`${pacificReturnDate()} >= ?`); params.push(query.from); }
  if (query.to) { filters.push(`${pacificReturnDate()} <= ?`); params.push(query.to); }
  if (query.sku) { filters.push('rr.sku = ?'); params.push(query.sku); }
  if (query.itemId) { filters.push('rr.item_id = ?'); params.push(query.itemId); }
  if (query.orderNumber) { filters.push('rr.order_number LIKE ?'); params.push(`%${query.orderNumber}%`); }
  if (query.status) { filters.push('rr.status = ?'); params.push(query.status); }
  if (query.returnId) { filters.push('rr.id = ?'); params.push(query.returnId); }
  if (query.storeIds || query.skuScopes) {
    const scopes: string[] = [];
    if (query.storeIds?.length) { scopes.push(`rr.store_id IN (${query.storeIds.map(() => '?').join(',')})`); params.push(...query.storeIds); }
    for (const scope of query.skuScopes ?? []) { scopes.push('(rr.store_id = ? AND rr.sku = ?)'); params.push(scope.storeId, scope.sku); }
    filters.push(scopes.length ? `(${scopes.join(' OR ')})` : '1 = 0');
  }
}

function mysqlRows<T extends Record<string, unknown>>(result: unknown): T[] {
  return Array.isArray(result) ? result as T[] : [];
}

type OrderChartRow = { kind: string; bucket: string | number | Date | null; count: string | number };
export function projectOrderChartRows(rows: OrderChartRow[]) {
  const dailyOrderTrend = rows.filter((row) => row.kind === 'daily' && row.bucket != null)
    .map((row) => ({ date: row.bucket instanceof Date ? row.bucket.toISOString().slice(0, 10) : String(row.bucket).slice(0, 10), count: Number(row.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const hourly = new Map(rows.filter((row) => row.kind === 'pacific_hour').map((row) => [Number(row.bucket), Number(row.count)]));
  const chinaHourly = new Map(rows.filter((row) => row.kind === 'china_hour').map((row) => [Number(row.bucket), Number(row.count)]));
  const regionDistribution = rows.filter((row) => row.kind === 'region' && row.bucket != null)
    .map((row) => ({ region: String(row.bucket), count: Number(row.count) }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));
  return {
    dailyOrderTrend,
    hourlyOrderTrend: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourly.get(hour) ?? 0 })),
    chinaHourlyOrderTrend: Array.from({ length: 24 }, (_, hour) => ({ hour, count: chinaHourly.get(hour) ?? 0 })),
    regionDistribution,
  };
}

export function projectCommerceRows(rows: RawCommerceRow[]) {
  const orders = new Map<string, ReturnType<typeof normalizeOrderPayload>[number]>();
  const returns = new Map<string, ReturnType<typeof normalizeReturnPayload>[number]>();
  const snapshots: ReturnSnapshot[] = [];
  const latestSnapshot = new Map<string, string>();
  const seenRaw = new Set<string>();
  for (const row of rows) {
    const context = { tenantId: row.tenantId, storeId: row.storeId, rawResponseId: row.externalId ?? String(row.id) };
    if (row.resource === 'orders') {
      for (const line of normalizeOrderPayload(row.payload, context)) orders.set(line.id, line);
    } else if (row.resource === 'returns') {
      if (seenRaw.has(`${row.tenantId}:${row.storeId}:${context.rawResponseId}`)) continue;
      seenRaw.add(`${row.tenantId}:${row.storeId}:${context.rawResponseId}`);
      for (const line of normalizeReturnPayload(row.payload, context)) {
        returns.set(line.id, line);
        const state = `${line.status}:${line.amount}:${line.returnedAt}`;
        if (latestSnapshot.get(line.id) !== state) {
          snapshots.push({ id: `${line.id}:${context.rawResponseId}`, returnId: line.id, status: line.status || 'UNKNOWN', ...(line.amount == null ? {} : { refundAmount: line.amount }), ...(line.returnedAt ? { returnedAt: line.returnedAt } : {}), rawResponseId: line.rawResponseId });
          latestSnapshot.set(line.id, state);
        }
      }
    }
  }
  return { orders: [...orders.values()], returns: [...returns.values()], snapshots };
}

export function mysqlCommerceSource(): CommerceSource {
  const { db, pool } = createDb();
  const productRateCache = createTtlCache<string, { rows: NonNullable<ReturnPageResult['productRates']>; total: number }>({ ttlMs: 30_000, maxEntries: 24 });
  return {
    // Commerce routes read normalized SQL rows; raw payload parsing stays in
    // the sync and migration paths only.
    listOrders: async (tenantId, query = {}) => {
      const [fromBound, toBound] = query.from && query.to ? pacificDateRangeBounds(query.from, query.to) : [query.from ? pacificMidnightUtc(query.from) : undefined, query.to ? pacificMidnightUtc(addCalendarDays(query.to, 1)) : undefined];
      const rows = await db.select({ orderId: orders.id, orderNumber: orders.externalId, storeId: orderLines.storeId, sku: skus.externalId, quantity: orderLines.quantity, amount: orderLines.lineAmount, orderedAt: orders.orderedAt, status: orders.status })
        .from(orderLines).innerJoin(orders, eq(orderLines.orderId, orders.id)).innerJoin(skus, eq(orderLines.skuId, skus.id))
        .where(and(eq(orderLines.tenantId, tenantId), eq(orders.tenantId, tenantId), ...(query.storeId ? [eq(orderLines.storeId, query.storeId)] : []), ...(query.sku ? [eq(skus.externalId, query.sku)] : []), ...(query.orderedAtOrAfter ? [gte(orders.orderedAt, query.orderedAtOrAfter)] : fromBound ? [gte(orders.orderedAt, fromBound)] : []), ...(toBound ? [sql`${orders.orderedAt} < ${toBound}`] : [])));
      return rows.map((row) => ({ orderId: row.orderId, orderNumber: row.orderNumber, tenantId, storeId: row.storeId, sku: row.sku, quantity: row.quantity == null ? null : Number(row.quantity), amount: row.amount == null ? null : Number(row.amount), ...(row.orderedAt ? { orderedAt: row.orderedAt.toISOString() } : {}), status: row.status }));
    },
    getOrderLines: async (tenantId, orderId, scope = {}) => {
      const params: unknown[] = [tenantId, tenantId, orderId];
      const filters = ['ol.tenant_id = ?', 'o.tenant_id = ?', 'o.id = ?'];
      if (scope.storeIds || scope.skuScopes) {
        const conditions: string[] = [];
        if (scope.storeIds?.length) { conditions.push(`ol.store_id IN (${scope.storeIds.map(() => '?').join(',')})`); params.push(...scope.storeIds); }
        for (const item of scope.skuScopes ?? []) { conditions.push('(ol.store_id = ? AND s.external_id = ?)'); params.push(item.storeId, item.sku); }
        filters.push(conditions.length ? `(${conditions.join(' OR ')})` : '1 = 0');
      }
      const [rows] = await pool.query(`SELECT ol.line_number AS lineNumber, o.id AS orderId, o.external_id AS orderNumber, ol.store_id AS storeId, s.external_id AS sku, s.item_id AS itemId, ol.quantity, ol.line_amount AS amount, o.ordered_at AS orderedAt, o.status FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id INNER JOIN skus s ON s.id = ol.sku_id WHERE ${filters.join(' AND ')} ORDER BY ol.line_number, ol.id`, params) as [Array<Record<string, unknown>>, unknown];
      const detailLines = rows.map((row) => ({ orderId: String(row.orderId), orderNumber: String(row.orderNumber), tenantId, storeId: String(row.storeId), sku: String(row.sku), itemId: row.itemId == null ? undefined : String(row.itemId), quantity: row.quantity == null ? null : Number(row.quantity), amount: row.amount == null ? null : Number(row.amount), ...(row.orderedAt == null ? {} : { orderedAt: new Date(row.orderedAt as string | Date).toISOString() }), status: String(row.status) }));
      const extended = await orderLineExtensions(pool,tenantId,mysqlRows<any>(rows));
      return detailLines.map((line:any,index:number)=>({...line,extensions:extended.get(`${line.storeId}:${line.orderNumber}:${mysqlRows<any>(rows)[index].lineNumber}`)}));
    },
    listOrdersPage: async (tenantId, query) => {
      const params: unknown[] = [tenantId, tenantId];
      const filters = ['ol.tenant_id = ?','o.tenant_id = ?'];
      if (query.storeId) { filters.push('ol.store_id = ?'); params.push(query.storeId); }
      if (query.storeIds || query.skuScopes) {
        const scopes: string[] = [];
        if (query.storeIds?.length) { scopes.push(`ol.store_id IN (${query.storeIds.map(() => '?').join(',')})`); params.push(...query.storeIds); }
        for (const scope of query.skuScopes ?? []) { scopes.push('(ol.store_id = ? AND s.external_id = ?)'); params.push(scope.storeId, scope.sku); }
        filters.push(scopes.length ? `(${scopes.join(' OR ')})` : '1 = 0');
      }
      const [fromBound, toBound] = query.from && query.to ? pacificDateRangeBounds(query.from, query.to) : [query.from ? pacificMidnightUtc(query.from) : undefined, query.to ? pacificMidnightUtc(addCalendarDays(query.to, 1)) : undefined];
      if (fromBound) { filters.push('o.ordered_at >= ?'); params.push(fromBound); }
      if (toBound) { filters.push('o.ordered_at < ?'); params.push(toBound); }
      if (query.sku) { filters.push('s.external_id = ?'); params.push(query.sku); }
      if (query.itemId) { filters.push('s.item_id = ?'); params.push(query.itemId); }
      if (query.orderNumber) { filters.push('o.external_id LIKE ?'); params.push(`%${query.orderNumber}%`); }
      if (query.status) { filters.push('o.status = ?'); params.push(query.status); }
      const where = filters.join(' AND ');
      const salesWhere = `${where} AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED')`;
      const offset = (query.page - 1) * query.pageSize;
      const pageParams = [...params, query.pageSize, offset];
      const chartWhere = `${salesWhere} AND o.ordered_at IS NOT NULL`;
      const chartSql = `WITH chart_orders AS (
        SELECT DISTINCT o.id, o.ordered_at, o.region
        FROM order_lines ol
        INNER JOIN orders o ON o.id = ol.order_id
        INNER JOIN skus s ON s.id = ol.sku_id
        WHERE ${chartWhere}
      )
      SELECT 'daily' AS kind, DATE(CONVERT_TZ(ordered_at, '+00:00', 'America/Los_Angeles')) AS bucket, COUNT(*) AS count FROM chart_orders GROUP BY bucket
      UNION ALL
      SELECT 'pacific_hour' AS kind, HOUR(CONVERT_TZ(ordered_at, '+00:00', 'America/Los_Angeles')) AS bucket, COUNT(*) AS count FROM chart_orders GROUP BY bucket
      UNION ALL
      SELECT 'china_hour' AS kind, HOUR(CONVERT_TZ(ordered_at, '+00:00', 'Asia/Shanghai')) AS bucket, COUNT(*) AS count FROM chart_orders GROUP BY bucket
      UNION ALL
      SELECT 'region' AS kind, region AS bucket, COUNT(*) AS count FROM chart_orders WHERE region IS NOT NULL AND region <> '' GROUP BY region`;
      const salesBySkuSql = `SELECT ol.store_id AS storeId, s.external_id AS sku, NULLIF(TRIM(s.item_id), '') AS itemId, CASE WHEN COUNT(ol.quantity) = COUNT(*) THEN SUM(ol.quantity) ELSE NULL END AS units, COUNT(DISTINCT o.id) AS orders, CASE WHEN COUNT(ol.line_amount) = COUNT(*) THEN SUM(ol.line_amount) ELSE NULL END AS revenue FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id INNER JOIN skus s ON s.id = ol.sku_id WHERE ${salesWhere} GROUP BY ol.store_id, s.external_id, itemId ORDER BY units DESC, orders DESC, s.external_id ASC`;
      const [countResult, metricsResult, pageResult, chartResult, salesBySkuResult] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id INNER JOIN skus s ON s.id = ol.sku_id WHERE ${where}`, params),
        pool.query(`SELECT COUNT(DISTINCT o.id) AS order_count, CASE WHEN COUNT(ol.quantity) = COUNT(*) THEN SUM(ol.quantity) ELSE NULL END AS units, CASE WHEN COUNT(ol.line_amount) = COUNT(*) THEN SUM(ol.line_amount) ELSE NULL END AS revenue FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id INNER JOIN skus s ON s.id = ol.sku_id WHERE ${salesWhere}`, params),
        pool.query(`SELECT o.id AS orderId, o.external_id AS orderNumber, ol.store_id AS storeId, s.external_id AS sku, s.item_id AS itemId, ol.quantity, ol.line_amount AS amount, o.ordered_at AS orderedAt, o.status FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id INNER JOIN skus s ON s.id = ol.sku_id WHERE ${where} ORDER BY o.ordered_at IS NULL ASC, o.ordered_at DESC, o.id ASC LIMIT ? OFFSET ?`, pageParams),
        pool.query(chartSql, params),
        query.salesView ? pool.query(salesBySkuSql, params) : Promise.resolve([[], undefined]),
      ]);
      const countRows = mysqlRows<Record<string, unknown>>((countResult as unknown[])[0]);
      const metricRows = mysqlRows<Record<string, unknown>>((metricsResult as unknown[])[0]);
      const pageRows = mysqlRows<Record<string, unknown>>((pageResult as unknown[])[0]);
      const chartRows = mysqlRows<OrderChartRow>((chartResult as unknown[])[0]);
      const salesBySkuRows = mysqlRows<Record<string, unknown>>((salesBySkuResult as unknown[])[0]);
      const charts = projectOrderChartRows(chartRows);
      const row = countRows[0] ?? {};
      const metricRow = metricRows[0] ?? {};
      return {
        rows: pageRows.map((item) => ({ orderId: String(item.orderId), orderNumber: String(item.orderNumber), tenantId, storeId: String(item.storeId), sku: String(item.sku), itemId: item.itemId == null ? undefined : String(item.itemId), quantity: item.quantity == null ? null : Number(item.quantity), amount: item.amount == null ? null : Number(item.amount), ...(item.orderedAt == null ? {} : { orderedAt: new Date(item.orderedAt as string | Date).toISOString() }), status: String(item.status) })),
        total: Number(row.total ?? 0),
        metrics: { orders: Number(metricRow.order_count ?? 0), units: metricRow.units == null ? null : Number(metricRow.units), revenue: metricRow.revenue == null ? null : Number(metricRow.revenue) },
        ...charts,
        salesBySku: salesBySkuRows.map((item) => ({ storeId: String(item.storeId), sku: String(item.sku), itemId: item.itemId == null ? undefined : String(item.itemId), units: item.units == null ? null : Number(item.units), orders: Number(item.orders ?? 0), revenue: item.revenue == null ? null : Number(item.revenue) })),
      };
    },
    listReturns: async (tenantId, query = {}) => {
      const rows = await db.select().from(returnRecords).where(and(eq(returnRecords.tenantId, tenantId), ...(query.storeId ? [eq(returnRecords.storeId, query.storeId)] : []), ...(query.from ? [gte(returnRecords.returnedAt, query.from)] : []), ...(query.to ? [lte(returnRecords.returnedAt, `${query.to}\uffff`)] : [])));
      return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, storeId: row.storeId, orderId: row.orderId, orderNumber: row.orderNumber ?? undefined, itemId: row.itemId ?? undefined, sku: row.sku ?? '', status: row.status, amount: row.amount == null ? null : Number(row.amount), reason: row.reason ?? undefined, reasonCode: row.reasonCode ?? undefined, refundCoveredBy: row.refundCoveredBy ?? undefined, refundChannelCoveredBy: row.refundChannelCoveredBy ?? undefined, isReturnForException: row.isReturnForException == null ? undefined : Boolean(row.isReturnForException), returnChannelName: row.returnChannelName ?? undefined, returnedAt: row.returnedAt }));
    },
    listReturnsPage: async (tenantId, query) => {
      const { pool } = createDb();
      const filters = ['rr.tenant_id = ?']; const params: unknown[] = [tenantId];
      appendReturnFilters(filters, params, query);
      if (query.reconciliation) {
        filters.push("UPPER(TRIM(COALESCE(rr.refund_covered_by, ''))) IN ('WALMART','WALMART KEEP-IT')");
        filters.push(wfsDebitExistsSql('rr'));
      }
      const where = filters.join(' AND ');
      const pageFilters = [...filters]; const pageParams = [...params];
      const responsibilityFilter = query.responsibility === 'wfs' ? " AND UPPER(TRIM(COALESCE(rr.refund_covered_by, ''))) IN ('WALMART','WALMART KEEP-IT')" : '';
      if (responsibilityFilter) pageFilters.push(responsibilityFilter.slice(5));
      if (query.reason) { pageFilters.push(sellerReturnFilterSql('rr')); pageFilters.push(`${returnReasonLabelSql('rr')} = ?`); pageParams.push(query.reason); }
      const pageWhere = pageFilters.join(' AND ');
      const offset = (query.page - 1) * query.pageSize;
      if (query.productRates) {
        const baseFilters = ['o.tenant_id = ?', 'ol.tenant_id = ?', "UPPER(TRIM(o.status)) NOT IN ('CANCELED','CANCELLED')"];
        const baseParams: unknown[] = [tenantId, tenantId];
        if (query.storeId) { baseFilters.push('ol.store_id = ?'); baseParams.push(query.storeId); }
        if (query.sku) { baseFilters.push('s.external_id = ?'); baseParams.push(query.sku); }
        if (query.itemId) { baseFilters.push('s.item_id = ?'); baseParams.push(query.itemId); }
        if (query.from) { baseFilters.push("DATE(CONVERT_TZ(o.ordered_at, '+00:00', 'America/Los_Angeles')) >= ?"); baseParams.push(query.from); }
        if (query.to) { baseFilters.push("DATE(CONVERT_TZ(o.ordered_at, '+00:00', 'America/Los_Angeles')) <= ?"); baseParams.push(query.to); }
        if (query.storeIds || query.skuScopes) {
          const scopes: string[] = [];
          if (query.storeIds?.length) { scopes.push(`ol.store_id IN (${query.storeIds.map(() => '?').join(',')})`); baseParams.push(...query.storeIds); }
          for (const scope of query.skuScopes ?? []) { scopes.push('(ol.store_id = ? AND s.external_id = ?)'); baseParams.push(scope.storeId, scope.sku); }
          baseFilters.push(scopes.length ? `(${scopes.join(' OR ')})` : '1 = 0');
        }
        const returnsWhere = ['rr.tenant_id = ?', "UPPER(TRIM(COALESCE(rr.refund_covered_by, ''))) IN ('SELLER','SELLER KEEP-IT')"]; const returnsParams: unknown[] = [tenantId];
        if (query.storeId) { returnsWhere.push('rr.store_id = ?'); returnsParams.push(query.storeId); }
        if (query.sku) { returnsWhere.push('rr.sku = ?'); returnsParams.push(query.sku); }
        if (query.itemId) { returnsWhere.push('rr.item_id = ?'); returnsParams.push(query.itemId); }
        if (query.from) { returnsWhere.push(`${pacificReturnDate()} >= ?`); returnsParams.push(query.from); }
        if (query.to) { returnsWhere.push(`${pacificReturnDate()} <= ?`); returnsParams.push(query.to); }
        if (query.storeIds || query.skuScopes) {
          const scopes: string[] = [];
          if (query.storeIds?.length) { scopes.push(`rr.store_id IN (${query.storeIds.map(() => '?').join(',')})`); returnsParams.push(...query.storeIds); }
          for (const scope of query.skuScopes ?? []) { scopes.push('(rr.store_id = ? AND rr.sku = ?)'); returnsParams.push(scope.storeId,scope.sku); }
          returnsWhere.push(scopes.length ? `(${scopes.join(' OR ')})` : '1 = 0');
        }
        const sortColumns: Record<string,string> = { sku: 'sku', productName: 'productName', orderCount: 'orderCount', returnedOrderCount: 'returnedOrderCount', returnRate: 'returnRate' };
        const orderBy = sortColumns[query.sort ?? 'returnRate'] ?? 'returnRate'; const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
        const joined = `FROM orders o INNER JOIN order_lines ol ON ol.order_id = o.id AND ol.tenant_id = o.tenant_id INNER JOIN skus s ON s.id = ol.sku_id AND s.tenant_id = o.tenant_id LEFT JOIN (SELECT rr.store_id, rr.sku, COUNT(DISTINCT COALESCE(rr.order_number,rr.order_id)) AS returnedOrderCount FROM return_records rr INNER JOIN orders ro ON ro.tenant_id=rr.tenant_id COLLATE utf8mb4_0900_ai_ci AND ro.external_id=rr.order_number COLLATE utf8mb4_0900_ai_ci AND ro.store_id=rr.store_id COLLATE utf8mb4_0900_ai_ci AND ro.status NOT IN ('CANCELED','CANCELLED') WHERE ${returnsWhere.join(' AND ')}${query.from ? " AND DATE(CONVERT_TZ(ro.ordered_at, '+00:00', 'America/Los_Angeles')) >= ?" : ''}${query.to ? " AND DATE(CONVERT_TZ(ro.ordered_at, '+00:00', 'America/Los_Angeles')) <= ?" : ''} GROUP BY rr.store_id, rr.sku) ret ON ret.store_id COLLATE utf8mb4_0900_ai_ci = ol.store_id AND ret.sku COLLATE utf8mb4_unicode_ci = s.external_id COLLATE utf8mb4_unicode_ci WHERE ${baseFilters.join(' AND ')}`;
        const scopeKey = JSON.stringify([
          tenantId, query.storeId ?? null, query.from ?? null, query.to ?? null, query.sku ?? null, query.itemId ?? null,
          query.sort ?? 'returnRate', direction,
          [...(query.storeIds ?? [])].sort(),
          [...(query.skuScopes ?? [])].map((scope) => [scope.storeId, scope.sku]).sort(([aStore, aSku], [bStore, bSku]) => aStore.localeCompare(bStore) || aSku.localeCompare(bSku)),
        ]);
        const aggregate = await productRateCache.getOrLoad(scopeKey, async () => {
          const result = await pool.query(`SELECT ol.store_id AS storeId,s.external_id AS sku,MAX(s.title) AS productName,COUNT(DISTINCT o.id) AS orderCount,COALESCE(MAX(ret.returnedOrderCount),0) AS returnedOrderCount,COALESCE(MAX(ret.returnedOrderCount),0)/NULLIF(COUNT(DISTINCT o.id),0) AS returnRate ${joined} GROUP BY ol.store_id,s.external_id ORDER BY ${orderBy} ${direction}, ol.store_id ASC,s.external_id ASC`, [...returnsParams,...(query.from ? [query.from] : []),...(query.to ? [query.to] : []),...baseParams]);
          const rows = mysqlRows<Record<string,unknown>>((result as unknown[])[0]);
          const productRates = rows.map((r) => ({ sku: String(r.sku), storeId: String(r.storeId), productName: r.productName == null ? undefined : String(r.productName), orderCount: Number(r.orderCount), returnedOrderCount: Number(r.returnedOrderCount), returnRate: r.returnRate == null ? null : Number(r.returnRate) }));
          return { rows: productRates, total: productRates.length };
        });
        return { rows: [], productRates: aggregate.rows.slice(offset, offset + query.pageSize), total: aggregate.total, analytics:{todayNew:0,monthReturnRate:null,returnedOrderCount:0,orderedOrderCount:0,monthRefundAmount:null,reasonDistribution:[],responsibilityDistribution:[],dailyTrend:[],topProducts:[]} };
      }
      const dedupSource = `(
        SELECT rr0.*, ROW_NUMBER() OVER (
          PARTITION BY ${query.reconciliation ? 'rr0.tenant_id, rr0.store_id, rr0.order_number, rr0.sku' : "rr0.tenant_id, rr0.store_id, COALESCE(rr0.return_order_id, ''), rr0.order_number, rr0.sku, rr0.amount"}
          ORDER BY CASE WHEN LOWER(COALESCE(rr0.return_order_item_id, '')) LIKE '%\\_l%' ESCAPE '\\\\' THEN 0 ELSE 1 END, rr0.updated_at DESC, rr0.id ASC
        ) AS duplicate_rank
        FROM return_records rr0 WHERE ${where.replaceAll('rr.', 'rr0.')}
      ) rr`;
      const sellerDedupSource = `(
        SELECT rr0.*, ROW_NUMBER() OVER (
          PARTITION BY ${query.reconciliation ? 'rr0.tenant_id, rr0.store_id, rr0.order_number, rr0.sku' : "rr0.tenant_id, rr0.store_id, COALESCE(rr0.return_order_id, ''), rr0.order_number, rr0.sku, rr0.amount"}
          ORDER BY CASE WHEN LOWER(COALESCE(rr0.return_order_item_id, '')) LIKE '%\\_l%' ESCAPE '\\\\' THEN 0 ELSE 1 END, rr0.updated_at DESC, rr0.id ASC
        ) AS duplicate_rank
        FROM return_records rr0 WHERE ${where.replaceAll('rr.', 'rr0.')} AND ${sellerReturnFilterSql('rr0')}
      ) rr`;
      const dedupPageFilter = responsibilityFilter + (query.reason ? ` AND ${sellerReturnFilterSql('rr')} AND ${returnReasonLabelSql('rr')} = ?` : '');
      const [countResult, rowResult] = await Promise.all([
        query.reconciliation ? pool.query(`SELECT COUNT(*) AS total FROM ${dedupSource} WHERE rr.duplicate_rank = 1${dedupPageFilter}`, [...params, ...(query.reason ? [query.reason] : [])]) : pool.query(`SELECT COUNT(*) AS total FROM (SELECT 1 FROM return_records rr WHERE ${pageWhere} GROUP BY rr.tenant_id, rr.store_id, COALESCE(rr.return_order_id, ''), rr.order_number, rr.sku, rr.amount) deduped`, [...pageParams]),
        pool.query(`SELECT id, return_order_id AS returnId, tenant_id AS tenantId, store_id AS storeId, order_id AS orderId, order_number AS orderNumber, item_id AS itemId, sku, status, amount, reason, reason_code AS reasonCode, refund_covered_by AS refundCoveredBy, refund_channel_covered_by AS refundChannelCoveredBy, is_return_for_exception AS isReturnForException, return_channel_name AS returnChannelName, returned_at AS returnedAt FROM ${dedupSource} WHERE duplicate_rank = 1${dedupPageFilter} ORDER BY returnedAt DESC, id ASC LIMIT ? OFFSET ?`, [...params, ...(query.reason ? [query.reason] : []), query.pageSize, offset]),
      ]);
      if (query.reconciliation) {
        const rows = mysqlRows<Record<string, unknown>>((rowResult as unknown[])[0]);
        return { rows: rows.map(row => ({ id: String(row.id), returnId: row.returnId == null ? undefined : String(row.returnId), tenantId: String(row.tenantId), storeId: String(row.storeId), orderId: String(row.orderId), orderNumber: row.orderNumber == null ? undefined : String(row.orderNumber), sku: String(row.sku ?? ''), status: String(row.status), amount: row.amount == null ? null : Number(row.amount), refundCoveredBy: row.refundCoveredBy == null ? undefined : String(row.refundCoveredBy) })), total: Number(mysqlRows<Record<string, unknown>>((countResult as unknown[])[0])[0]?.total ?? 0), analytics: { todayNew: 0, monthReturnRate: null, returnedOrderCount: 0, orderedOrderCount: 0, monthRefundAmount: null, reasonDistribution: [], responsibilityDistribution: [], dailyTrend: [], topProducts: [] } };
      }
      const today = todayPacificDate(); const month = today.slice(0, 7); const monthStart = `${month}-01`;
      const denominatorRange = returnRateOrderDateRange(query, today);
      const returnedDate = pacificReturnDate();
      const summarySql = `SELECT
        SUM(CASE WHEN ${returnedDate} = ? THEN 1 ELSE 0 END) AS todayNew,
        CASE WHEN SUM(CASE WHEN ${returnedDate} >= ? AND ${returnedDate} <= ? AND UPPER(rr.status) = 'REFUNDED' THEN 1 ELSE 0 END) = COUNT(CASE WHEN ${returnedDate} >= ? AND ${returnedDate} <= ? AND UPPER(rr.status) = 'REFUNDED' THEN 1 END)
          THEN SUM(CASE WHEN ${returnedDate} >= ? AND ${returnedDate} <= ? AND UPPER(rr.status) = 'REFUNDED' THEN rr.amount ELSE 0 END) ELSE NULL END AS monthRefundAmount
        FROM ${dedupSource} WHERE rr.duplicate_rank = 1`;
      const summaryParams = [today, monthStart, today, monthStart, today, monthStart, today, ...params];
      const reasonLabel = returnReasonLabelSql('rr');
      const reasonSql = `SELECT ${reasonLabel} AS reason, COUNT(*) AS count FROM ${sellerDedupSource} WHERE rr.duplicate_rank = 1 GROUP BY ${reasonLabel} ORDER BY count DESC, reason`;
      const responsibilitySql = `SELECT CASE WHEN UPPER(TRIM(COALESCE(rr.refund_covered_by, ''))) IN ('SELLER', 'SELLER KEEP-IT') THEN '卖家责任' WHEN UPPER(TRIM(COALESCE(rr.refund_covered_by, ''))) IN ('WALMART', 'WALMART KEEP-IT') THEN 'WFS责任' ELSE '其他/未提供' END AS responsibility, COUNT(*) AS count FROM ${dedupSource} WHERE rr.duplicate_rank = 1 GROUP BY responsibility ORDER BY count DESC, responsibility`;
      const sellerReturnedCountSql = `SELECT COUNT(DISTINCT rr.order_id) AS count FROM ${sellerDedupSource} WHERE rr.duplicate_rank = 1 AND ${returnedDate} >= ? AND ${returnedDate} <= ?`;
      const dailySql = `SELECT ${returnedDate} AS date, COUNT(*) AS count FROM ${dedupSource} WHERE rr.duplicate_rank = 1 AND ${returnedDate} >= ? AND ${returnedDate} <= ? GROUP BY date ORDER BY date`;
      const dailyParams = [...params, shiftCalendarDays(today, -29), today];
      const productsSql = `SELECT COALESCE(rr.sku, '') AS sku, COUNT(*) AS count FROM ${dedupSource} WHERE rr.duplicate_rank = 1 GROUP BY rr.sku ORDER BY count DESC, sku LIMIT 20`;
      const orderFilters = ['o.tenant_id = ?', 'o.ordered_at >= ?', 'o.ordered_at < ?', "UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED')"]; const orderParams: unknown[] = denominatorRange ? [tenantId, pacificMidnightUtc(denominatorRange.from), pacificMidnightUtc(addCalendarDays(denominatorRange.to, 1))] : [tenantId, pacificMidnightUtc(monthStart), pacificMidnightUtc(monthStart)];
      if (query.storeId) { orderFilters.push('ol.store_id = ?'); orderParams.push(query.storeId); }
      if (query.sku) { orderFilters.push('s.external_id = ?'); orderParams.push(query.sku); }
      if (query.itemId) { orderFilters.push('s.item_id = ?'); orderParams.push(query.itemId); }
      if (query.orderNumber) { orderFilters.push('o.external_id LIKE ?'); orderParams.push(`%${query.orderNumber}%`); }
      if (query.storeIds || query.skuScopes) {
        const scopes: string[] = [];
        if (query.storeIds?.length) { scopes.push(`ol.store_id IN (${query.storeIds.map(() => '?').join(',')})`); orderParams.push(...query.storeIds); }
        for (const scope of query.skuScopes ?? []) { scopes.push('(ol.store_id = ? AND s.external_id = ?)'); orderParams.push(scope.storeId, scope.sku); }
        orderFilters.push(scopes.length ? `(${scopes.join(' OR ')})` : '1 = 0');
      }
      const [summaryResult, reasonResult, responsibilityResult, dailyResult, productsResult, orderCountResult, sellerReturnedCountResult] = await Promise.all([
        pool.query(summarySql, summaryParams),
        pool.query(reasonSql, params),
        pool.query(responsibilitySql, params),
        pool.query(dailySql, dailyParams),
        pool.query(productsSql, params),
        denominatorRange ? pool.query(`SELECT COUNT(DISTINCT o.id) AS count FROM orders o INNER JOIN order_lines ol ON ol.order_id = o.id INNER JOIN skus s ON s.id = ol.sku_id WHERE ${orderFilters.join(' AND ')}`, orderParams) : Promise.resolve([[{ count: 0 }], undefined]),
        pool.query(sellerReturnedCountSql, [...params, monthStart, today]),
      ]);
      const countRows = mysqlRows<Record<string, unknown>>((countResult as unknown[])[0]);
      const rows = mysqlRows<Record<string, unknown>>((rowResult as unknown[])[0]);
      const summary = mysqlRows<Record<string, unknown>>((summaryResult as unknown[])[0])[0] ?? {};
      const reasons = mysqlRows<Record<string, unknown>>((reasonResult as unknown[])[0]);
      const responsibilities = mysqlRows<Record<string, unknown>>((responsibilityResult as unknown[])[0]);
      const days = mysqlRows<Record<string, unknown>>((dailyResult as unknown[])[0]);
      const products = mysqlRows<Record<string, unknown>>((productsResult as unknown[])[0]);
      const orderedOrderCount = Number(mysqlRows<Record<string, unknown>>((orderCountResult as unknown[])[0])[0]?.count ?? 0);
      const returnedOrderCount = Number(mysqlRows<Record<string, unknown>>((sellerReturnedCountResult as unknown[])[0])[0]?.count ?? 0);
      const dailyByDate = new Map(days.map((row) => [String(row.date), Number(row.count)]));
      return {
        rows: rows.map((row) => ({ id: String(row.id), returnId: row.returnId == null ? undefined : String(row.returnId), tenantId: String(row.tenantId), storeId: String(row.storeId), orderId: String(row.orderId), orderNumber: row.orderNumber == null ? undefined : String(row.orderNumber), itemId: row.itemId == null ? undefined : String(row.itemId), sku: row.sku == null ? '' : String(row.sku), status: String(row.status), amount: row.amount == null ? null : Number(row.amount), reason: row.reason == null ? undefined : String(row.reason), reasonCode: row.reasonCode == null ? undefined : String(row.reasonCode), refundCoveredBy: row.refundCoveredBy == null ? undefined : String(row.refundCoveredBy), refundChannelCoveredBy: row.refundChannelCoveredBy == null ? undefined : String(row.refundChannelCoveredBy), isReturnForException: row.isReturnForException == null ? undefined : Boolean(row.isReturnForException), returnChannelName: row.returnChannelName == null ? undefined : String(row.returnChannelName), returnedAt: row.returnedAt == null ? null : String(row.returnedAt) })),
        total: Number(countRows[0]?.total ?? 0),
        analytics: { todayNew: Number(summary.todayNew ?? 0), monthReturnRate: orderedOrderCount ? returnedOrderCount / orderedOrderCount : null, returnedOrderCount, orderedOrderCount, monthRefundAmount: summary.monthRefundAmount == null ? null : Number(summary.monthRefundAmount), reasonDistribution: reasons.map((row) => ({ reason: String(row.reason), count: Number(row.count) })), responsibilityDistribution: responsibilities.map((row) => ({ responsibility: String(row.responsibility), count: Number(row.count) })), dailyTrend: Array.from({ length: 30 }, (_, index) => { const date = shiftCalendarDays(today, index - 29); return { date, count: dailyByDate.get(date) ?? 0 }; }), topProducts: products.map((row) => ({ sku: String(row.sku), count: Number(row.count) })) },
      };
    },
    listReturnSnapshots: async (tenantId, query = {}) => {
      const { db } = createDb();
      const conditions = [eq(returnStatusEvents.tenantId, tenantId), ...(query.storeId ? [eq(returnStatusEvents.storeId, query.storeId)] : []), ...(query.returnId ? [eq(returnStatusEvents.returnId, query.returnId)] : []), ...(query.from ? [gte(returnStatusEvents.returnedAt, new Date(`${query.from}T00:00:00.000Z`))] : []), ...(query.to ? [lte(returnStatusEvents.returnedAt, new Date(`${query.to}T23:59:59.999Z`))] : [])];
      if (query.storeIds?.length) conditions.push(sql`${returnStatusEvents.storeId} in (${sql.join(query.storeIds.map((id) => sql`${id}`), sql`, `)})`);
      const rows = await db.select({ id: returnStatusEvents.id, returnId: returnStatusEvents.returnId, status: returnStatusEvents.status, refundAmount: returnStatusEvents.refundAmount, returnedAt: returnStatusEvents.returnedAt, rawResponseId: returnStatusEvents.rawResponseId }).from(returnStatusEvents).where(and(...conditions)).orderBy(returnStatusEvents.recordedAt);
      return rows.map((row) => ({ id: row.id, returnId: row.returnId, status: row.status, ...(row.refundAmount == null ? {} : { refundAmount: Number(row.refundAmount) }), ...(row.returnedAt ? { returnedAt: row.returnedAt.toISOString() } : {}), rawResponseId: row.rawResponseId ?? '' }));
    },
  };
}

export class CommerceUnavailableError extends Error { constructor() { super('Commerce data source is not configured'); } }
export function unavailableCommerceSource(): CommerceSource {
  // Keep the local UI usable when the optional database is not running. The
  // configured MySQL source is selected automatically once MYSQL_URL exists.
  const empty = async () => [];
  return { listOrders: empty, listReturns: empty, listReturnSnapshots: empty };
}
