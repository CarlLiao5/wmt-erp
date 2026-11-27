import { loadDashboardProfit, mergeSnapshotProfit } from './dashboard-profit.js';
import { Router, type Request } from 'express';
import { dateRangeError } from './date-range.js';
import { pacificDateRangeBounds } from './commerce-source.js';
import { and, createDb, dailyFacts, eq, gte, inArray, lte, orderLines, stores, skus, inventorySnapshots, semPerformanceDaily } from '@walmart-erp/db';
import { isCancelledOrderStatus } from '../../../../packages/domain/src/orderStatus.js';
export interface DashboardRow { date: string; revenue: number; orders: number; units: number; refunds?: number; profit?: number | null; estimated?: boolean; refreshedAt?: string; }
export interface DashboardExtras { stores: Array<{ storeId: string; storeName: string; revenue: number; orders: number; units: number }>; stockoutRisk: Array<{ sku: string; title: string; inventory: number; units30d: number; daysLeft: number | null }>; adSpend: { today: number | null; month: number | null; trend: Array<{ date: string; onsite: number; sem: number }> }; highAcos: Array<{ sku: string; storeName: string; spend: number; sales: number; acos: number }>; }
export interface DashboardVisibility { role: 'admin' | 'member'; storeIds: Set<string>; skus: Set<string>; }
export function formatFactDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
export function todayPacificDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function dashboardRange(filters: { from?: string; to?: string }) {
  const to = filters.to ?? todayPacificDate();
  return { from: filters.from ?? shiftDate(to, -29), to };
}
function utcQueryBounds(range: { from: string; to: string }) { const [from, to] = pacificDateRangeBounds(range.from, range.to); return { from, to }; }
function dateColumnBound(value: string) { return new Date(`${value}T00:00:00.000Z`); }

export function orderFallbackRows(orderRows: Array<{ id: string; orderedAt: Date | string; totalAmount: string | number | null; status?: string | null }>, lineRows: Array<{ orderId: string; quantity: string | number | null }>, onlyDate?: string): DashboardRow[] {
  const unitsByOrder = new Map<string, number>();
  for (const line of lineRows) if (line.quantity != null) unitsByOrder.set(line.orderId, (unitsByOrder.get(line.orderId) ?? 0) + Number(line.quantity));
  const grouped = new Map<string, DashboardRow>();
  for (const order of orderRows) {
    if (isCancelledOrderStatus(order.status)) continue;
    const date = todayPacificDate(new Date(order.orderedAt));
    if (onlyDate && date !== onlyDate) continue;
    const row = grouped.get(date) ?? { date, revenue: 0, orders: 0, units: 0, refunds: 0, profit: null, estimated: true };
    if (order.totalAmount != null) row.revenue += Number(order.totalAmount);
    row.orders += 1;
    row.units += unitsByOrder.get(order.id) ?? 0;
    grouped.set(date, row);
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function withinDateRange(rows: DashboardRow[], filters: { from?: string; to?: string }): DashboardRow[] {
  return rows.filter((row) => (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to));
}
export function mergeDailySalesRows(
  factRows: DashboardRow[],
  salesRows: Array<{ date: string; revenue: number | null; orders: number; units: number }>,
): DashboardRow[] {
  const grouped = new Map(factRows.map((row) => [row.date, { ...row }]));
  for (const sales of salesRows) {
    const current = grouped.get(sales.date) ?? { date: sales.date, revenue: 0, orders: 0, units: 0, refunds: 0, profit: null, estimated: true };
    if (sales.revenue != null) current.revenue = sales.revenue;
    current.orders = sales.orders;
    current.units = sales.units;
    grouped.set(sales.date, current);
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function dedupeFactRows(rows: Array<{ storeId: string; date: string; metric: string; value: number }>) {
  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.storeId + ':' + row.date + ':' + row.metric;
    const previous = map.get(key);
    if (!previous || row.value > previous.value) map.set(key, row);
  }
  return [...map.values()];
}
export function dedupeSemPerformanceRows<T extends { storeId: string; factDate: Date | string; campaignId: string | null; sku: string; receivedAt: Date | string }>(rows: T[]): T[] {
  const latestByKey = new Map<string, number>();
  const keyOf = (row: T) => `${row.storeId}\u0000${formatFactDate(row.factDate)}\u0000${row.campaignId ?? ''}\u0000${row.sku}`;
  for (const row of rows) {
    const key = keyOf(row);
    const receivedAt = new Date(row.receivedAt).getTime();
    latestByKey.set(key, Math.max(latestByKey.get(key) ?? -Infinity, receivedAt));
  }
  return rows.filter((row) => new Date(row.receivedAt).getTime() === latestByKey.get(keyOf(row)));
}
export function stockoutRisk(rows: Array<{ sku: string; title: string; inventory: number; units30d: number }>) {
  return rows.map((row) => ({ ...row, daysLeft: row.units30d > 0 ? Math.round(row.inventory / (row.units30d / 30) * 10) / 10 : null }))
    .filter((row) => row.daysLeft !== null && row.daysLeft <= 30)
    .sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number)).slice(0, 10);
}
function stockoutRiskInputs(skus: Array<{ id: string; externalId: string; title: string | null }>, snapshots: Array<{ skuId: string; quantity: string | number; occurredAt: Date | string }>, lineRows: Array<{ skuId: string; quantity: string | number }>) {
  const latestInventory = new Map<string, { occurredAt: number; quantity: number }>();
  for (const row of snapshots) {
    const occurredAt = new Date(row.occurredAt).getTime();
    const current = latestInventory.get(row.skuId);
    if (!current || occurredAt > current.occurredAt) latestInventory.set(row.skuId, { occurredAt, quantity: Number(row.quantity) });
  }
  const unitsBySku = new Map<string, number>();
  for (const row of lineRows) unitsBySku.set(row.skuId, (unitsBySku.get(row.skuId) ?? 0) + Number(row.quantity));
  return skus.map((sku) => ({ sku: sku.externalId, title: sku.title ?? sku.externalId, inventory: latestInventory.get(sku.id)?.quantity ?? 0, units30d: unitsBySku.get(sku.id) ?? 0 }));
}
export function mysqlDashboardSource() {
  const { db, pool } = createDb();
  return async (tenantId: string, storeId?: string, filters: { skuId?: string; from?: string; to?: string } = {}, visibility?: DashboardVisibility): Promise<DashboardRow[]> => {
    const range = dashboardRange(filters);
    const bounds = utcQueryBounds(range);
    const allowedStores = visibility?.role === 'member' ? [...new Set([...visibility.storeIds, ...[...visibility.skus].map((grant) => grant.split(':', 1)[0]).filter(Boolean)])] : undefined;
    const storeFilter = storeId ? [eq(dailyFacts.storeId, storeId)] : allowedStores?.length ? [inArray(dailyFacts.storeId, allowedStores)] : [];
    const rowsPromise = db.select().from(dailyFacts).where(and(eq(dailyFacts.tenantId, tenantId), gte(dailyFacts.factDate, dateColumnBound(range.from)), lte(dailyFacts.factDate, dateColumnBound(range.to)), ...storeFilter));
    const scopeParts: string[] = [];
    const salesParams: unknown[] = [tenantId, bounds.from, bounds.to];
    if (storeId) {
      scopeParts.push('o.store_id = ?');
      salesParams.push(storeId);
    } else if (visibility?.role === 'member') {
      const scopes: string[] = [];
      const fullStoreIds = [...visibility.storeIds];
      if (fullStoreIds.length) {
        scopes.push(`o.store_id IN (${fullStoreIds.map(() => '?').join(',')})`);
        salesParams.push(...fullStoreIds);
      }
      for (const grant of visibility.skus) {
        const separator = grant.indexOf(':');
        if (separator < 0) continue;
        scopes.push('(o.store_id = ? AND s.external_id COLLATE utf8mb4_0900_ai_ci = ? COLLATE utf8mb4_0900_ai_ci)');
        salesParams.push(grant.slice(0, separator), grant.slice(separator + 1));
      }
      scopeParts.push(scopes.length ? `(${scopes.join(' OR ')})` : '1 = 0');
    }
    if (filters.skuId) {
      scopeParts.push('ol.sku_id = ?');
      salesParams.push(filters.skuId);
    }
    const salesScopeFilter = scopeParts.length ? ` AND ${scopeParts.join(' AND ')}` : '';
    const salesRowsPromise = pool.query(`SELECT DATE_FORMAT(CONVERT_TZ(o.ordered_at, '+00:00', 'America/Los_Angeles'), '%Y-%m-%d') AS date,
      COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(ol.quantity), 0) AS units, SUM(ol.line_amount) AS revenue
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.tenant_id = o.tenant_id AND ol.store_id = o.store_id
      LEFT JOIN skus s ON s.id = ol.sku_id AND s.tenant_id = ol.tenant_id AND s.store_id = ol.store_id
      WHERE o.tenant_id = ? AND o.ordered_at >= ? AND o.ordered_at < ?
        AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED')${salesScopeFilter}
      GROUP BY date ORDER BY date`, salesParams) as Promise<[Array<{ date: string; orders: string | number; units: string | number; revenue: string | number | null }>, unknown]>;
    const orderStoreFilter = storeId ? ` AND store_id = ?` : allowedStores?.length ? ` AND store_id IN (${allowedStores.map(() => '?').join(',')})` : '';
    const freshnessParams = [tenantId, bounds.from, bounds.to, ...(storeId ? [storeId] : allowedStores ?? [])];
    const freshnessPromise = pool.query(`SELECT MAX(updated_at) AS refreshedAt FROM orders WHERE tenant_id = ? AND ordered_at >= ? AND ordered_at < ?${orderStoreFilter}`, freshnessParams) as Promise<[Array<{ refreshedAt: Date | string | null }>, unknown]>;
    const [rows, [freshnessRows], [salesRows], profitEntries] = await Promise.all([
      rowsPromise, freshnessPromise, salesRowsPromise,
      visibility?.role === 'admin' && !filters.skuId
        ? loadDashboardProfit(tenantId, range.from, range.to, storeId).catch(error => {
          console.error('Dashboard profit snapshot read failed:', error.code ?? 'unknown');
          return [];
        })
        : [],
    ]);
    const latest = freshnessRows[0]?.refreshedAt ?? null;
    const refreshedAt = latest instanceof Date ? latest.toISOString() : latest ? String(latest) : null;
    const grouped = new Map<string, DashboardRow>();
    const unique = dedupeFactRows(rows.map((row) => ({ storeId: row.storeId, date: formatFactDate(row.factDate), metric: row.metric, value: Number(row.value) })));
    for (const row of unique) { const date = row.date; if ((filters.from && date < filters.from) || (filters.to && date > filters.to)) continue; const current = grouped.get(date) ?? { date, revenue: 0, orders: 0, units: 0, refunds: 0, profit: null, estimated: true, refreshedAt: refreshedAt ?? date }; const value = row.value; if (row.metric === 'revenue') current.revenue += value; else if (row.metric === 'orders') current.orders += value; else if (row.metric === 'units') current.units += value; else if (row.metric === 'refunds') current.refunds = (current.refunds ?? 0) + value; else if (row.metric === 'profit') { current.profit = (current.profit ?? 0) + value; current.estimated = false; } grouped.set(date, current); }
    const factRows = [...grouped.values()];
    const merged = mergeDailySalesRows(factRows, salesRows.map((row) => ({ date: row.date, revenue: row.revenue == null ? null : Number(row.revenue), orders: Number(row.orders), units: Number(row.units) })));
    return mergeSnapshotProfit(merged, profitEntries, range.from, range.to).map((row) => ({ ...row, refreshedAt: row.refreshedAt ?? refreshedAt ?? row.date }));
  };
}
export function mysqlDashboardExtras() {
  const { db, pool } = createDb();
  return async (tenantId: string, filters: { storeId?: string; skuId?: string; from?: string; to?: string } = {}, visibility?: DashboardVisibility): Promise<DashboardExtras> => {
    const range = dashboardRange(filters);
    const bounds = utcQueryBounds(range);
    const allowedStores = visibility?.role === 'member' ? [...new Set([...visibility.storeIds, ...[...visibility.skus].map((grant) => grant.split(':', 1)[0]).filter(Boolean)])] : undefined;
    const [storeRows, skuRows] = await Promise.all([
      db.select({ id: stores.id, name: stores.name }).from(stores).where(and(eq(stores.tenantId, tenantId), ...(filters.storeId ? [eq(stores.id, filters.storeId)] : []), ...(allowedStores?.length ? [inArray(stores.id, allowedStores)] : []))),
      db.select({ id: skus.id, externalId: skus.externalId, title: skus.title, storeId: skus.storeId }).from(skus).where(and(eq(skus.tenantId, tenantId), ...(filters.storeId ? [eq(skus.storeId, filters.storeId)] : []), ...(allowedStores?.length ? [inArray(skus.storeId, allowedStores)] : []))),
    ]);
    const storeSqlFilter = filters.storeId ? ' AND store_id = ?' : allowedStores?.length ? ` AND store_id IN (${allowedStores.map(() => '?').join(',')})` : '';
    const orderSqlFilter = filters.storeId ? ' AND o.store_id = ?' : allowedStores?.length ? ` AND o.store_id IN (${allowedStores.map(() => '?').join(',')})` : '';
    const orderParams = [tenantId, bounds.from, bounds.to, ...(filters.storeId ? [filters.storeId] : allowedStores ?? [])];
    const orderSkuFilter = filters.skuId ? ' AND EXISTS (SELECT 1 FROM order_lines olx WHERE olx.tenant_id = o.tenant_id AND olx.order_id = o.id AND olx.sku_id = ?)' : '';
    const orderRowsPromise = pool.query(`SELECT o.store_id AS storeId, COUNT(*) AS orders, SUM(o.total_amount) AS revenue FROM orders o WHERE o.tenant_id = ? AND o.ordered_at >= ? AND o.ordered_at < ? AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED')${orderSqlFilter}${orderSkuFilter} GROUP BY o.store_id`, [...orderParams, ...(filters.skuId ? [filters.skuId] : [])]) as Promise<[Array<{ storeId: string; orders: string | number; revenue: string | number }>, unknown]>;
    const lineSkuFilter = filters.skuId ? ' AND sku_id = ?' : '';
    const lineRowsPromise = pool.query(`SELECT ol.store_id AS storeId, COUNT(DISTINCT ol.order_id) AS orders, SUM(ol.quantity) AS units, SUM(ol.line_amount) AS revenue FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id WHERE ol.tenant_id = ?${storeSqlFilter.replaceAll('store_id', 'ol.store_id')}${lineSkuFilter.replaceAll('sku_id', 'ol.sku_id')} AND o.ordered_at >= ? AND o.ordered_at < ? AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED') GROUP BY ol.store_id`, [tenantId, ...(filters.storeId ? [filters.storeId] : allowedStores ?? []), ...(filters.skuId ? [filters.skuId] : []), bounds.from, bounds.to]) as Promise<[Array<{ storeId: string; orders: string | number; units: string | number; revenue: string | number }>, unknown]>;
    const allowedSkuValues = visibility?.role === 'member' ? visibility.skus : undefined;
    const visibleSkuRows = skuRows.filter((sku) => (!filters.skuId || sku.id === filters.skuId) && (!allowedSkuValues?.size || allowedSkuValues.has(`${sku.storeId}:${sku.externalId}`)));
    const snapshotsPromise = visibleSkuRows.length ? pool.query(`SELECT snap.sku_id AS skuId, snap.quantity, snap.occurred_at AS occurredAt FROM inventory_snapshots snap INNER JOIN skus snapSku ON snapSku.tenant_id = snap.tenant_id AND (snapSku.id = snap.sku_id OR CONCAT(snap.store_id, ':', UPPER(snapSku.external_id)) = UPPER(snap.sku_id)) INNER JOIN (SELECT sku_id, MAX(occurred_at) AS latest FROM inventory_snapshots WHERE tenant_id = ? GROUP BY sku_id) latest ON latest.sku_id = snap.sku_id AND latest.latest = snap.occurred_at WHERE snap.tenant_id = ? AND snapSku.id IN (${visibleSkuRows.map(() => '?').join(',')})`, [tenantId, tenantId, ...visibleSkuRows.map((sku) => sku.id)]) as Promise<[Array<{ skuId: string; quantity: string | number; occurredAt: Date | string }>, unknown]> : Promise.resolve([[] as Array<{ skuId: string; quantity: string | number; occurredAt: Date | string }>, undefined] as const);
    const unitsPromise = visibleSkuRows.length ? pool.query(`SELECT ol.sku_id AS skuId, SUM(ol.quantity) AS units30d FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id WHERE ol.tenant_id = ? AND o.tenant_id = ? AND o.ordered_at >= ? AND o.ordered_at < ? AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED') AND ol.sku_id IN (${visibleSkuRows.map(() => '?').join(',')}) GROUP BY ol.sku_id`, [tenantId, tenantId, bounds.from, bounds.to, ...visibleSkuRows.map((sku) => sku.id)]) as Promise<[Array<{ skuId: string; units30d: string | number }>, unknown]> : Promise.resolve([[] as Array<{ skuId: string; units30d: string | number }>, undefined] as const);
    const [[orderRows], [lineRows], [snapshots], [unitsRows]] = await Promise.all([orderRowsPromise, lineRowsPromise, snapshotsPromise, unitsPromise]);
    const unitsBySku = new Map(unitsRows.map((row) => [row.skuId, Number(row.units30d)]));
    const latestInventory = new Map<string, number>();
    for (const row of snapshots) latestInventory.set(row.skuId, Number(row.quantity));
    const riskInputs = visibleSkuRows.map((sku) => ({ sku: sku.externalId, title: sku.title ?? sku.externalId, inventory: latestInventory.get(sku.id) ?? 0, units30d: unitsBySku.get(sku.id) ?? 0 }));
    const risk = stockoutRisk(riskInputs);
    const salesByStore = new Map(orderRows.map((row) => [row.storeId, row]));
    const linesByStore = new Map(lineRows.map((row) => [row.storeId, row]));
    const storesOut = storeRows.map((store) => {
      const orderStore = salesByStore.get(store.id);
      const lines = linesByStore.get(store.id);
      return { storeId: store.id, storeName: store.name, revenue: filters.skuId ? Number(lines?.revenue ?? 0) : Number(orderStore?.revenue ?? 0), orders: filters.skuId ? Number(lines?.orders ?? 0) : Number(orderStore?.orders ?? 0), units: Number(lines?.units ?? 0) };
    });
    const semDailyPromise = db.select({ storeId: semPerformanceDaily.storeId, factDate: semPerformanceDaily.reportDate, campaignId: semPerformanceDaily.campaignId, sku: semPerformanceDaily.sku, spend: semPerformanceDaily.adSpend, receivedAt: semPerformanceDaily.receivedAt }).from(semPerformanceDaily).where(and(eq(semPerformanceDaily.tenantId, tenantId), gte(semPerformanceDaily.reportDate, dateColumnBound(range.from)), lte(semPerformanceDaily.reportDate, dateColumnBound(range.to)), ...(filters.storeId ? [eq(semPerformanceDaily.storeId, filters.storeId)] : []), ...(allowedStores?.length ? [inArray(semPerformanceDaily.storeId, allowedStores)] : [])));
    const onsiteStoreFilter = filters.storeId ? ` AND s.id = ?` : allowedStores?.length ? ` AND s.id IN (${allowedStores.map(() => '?').join(',')})` : '';
    const onsiteParams = [tenantId, ...(filters.storeId ? [filters.storeId] : allowedStores ?? []), range.from, range.to];
    const onsiteRowsPromise = pool.query(`SELECT a.report_date AS factDate, SUM(a.spend) AS spend FROM ad_item_report a INNER JOIN stores s ON s.tenant_id = ? AND (s.name COLLATE utf8mb4_unicode_ci = a.store_name COLLATE utf8mb4_unicode_ci OR (a.store_name COLLATE utf8mb4_unicode_ci = '鑫起典沃尔玛' COLLATE utf8mb4_unicode_ci AND s.name COLLATE utf8mb4_unicode_ci = '鑫启典沃尔玛' COLLATE utf8mb4_unicode_ci)) WHERE 1=1${onsiteStoreFilter} AND a.report_date >= ? AND a.report_date <= ? GROUP BY a.report_date`, onsiteParams) as Promise<[Array<{ factDate: Date | string; spend: string | number | null }>, unknown]>;
    const acosParams = [tenantId, range.from, range.to, tenantId, range.from, range.to, tenantId, bounds.from, bounds.to, ...(filters.storeId ? [filters.storeId] : allowedStores ?? []), ...(filters.skuId ? [filters.skuId] : [])];
    const acosStoreFilter = filters.storeId ? ' AND ol.store_id = ?' : allowedStores?.length ? ` AND ol.store_id IN (${allowedStores.map(() => '?').join(',')})` : '';
    const acosSkuFilter = filters.skuId ? ' AND s.id = ?' : '';
    const acosRowsPromise = pool.query(`SELECT a.sku, COALESCE(s.name, a.storeName) AS storeName, (a.onsiteSpend + COALESCE(sem.semSpend, 0)) AS spend, COALESCE(sales.sales, 0) AS sales FROM (SELECT a.msku AS sku, st.id AS storeId, st.name AS storeName, SUM(a.spend) AS onsiteSpend FROM ad_item_report a INNER JOIN stores st ON st.tenant_id = ? AND (st.name COLLATE utf8mb4_unicode_ci = a.store_name COLLATE utf8mb4_unicode_ci OR (a.store_name COLLATE utf8mb4_unicode_ci = '鑫起典沃尔玛' COLLATE utf8mb4_unicode_ci AND st.name COLLATE utf8mb4_unicode_ci = '鑫启典沃尔玛' COLLATE utf8mb4_unicode_ci)) WHERE a.report_date >= ? AND a.report_date <= ? GROUP BY a.msku, st.id, st.name) a LEFT JOIN (SELECT sp.sku, sp.store_id, SUM(sp.ad_spend) AS semSpend FROM sem_search_terms_daily sp INNER JOIN (SELECT store_id, report_date, campaign_id, sku, MAX(received_at) AS received_at FROM sem_search_terms_daily WHERE tenant_id = ? AND report_date >= ? AND report_date <= ? GROUP BY store_id, report_date, campaign_id, sku) latest ON latest.store_id = sp.store_id AND latest.report_date = sp.report_date AND latest.campaign_id = sp.campaign_id AND latest.sku = sp.sku AND latest.received_at = sp.received_at WHERE sp.tenant_id = ? GROUP BY sp.store_id, sp.sku) sem ON sem.store_id = a.storeId AND sem.sku COLLATE utf8mb4_unicode_ci = a.sku COLLATE utf8mb4_unicode_ci LEFT JOIN (SELECT s.external_id AS sku, ol.store_id, SUM(ol.line_amount) AS sales FROM order_lines ol INNER JOIN orders o ON o.id = ol.order_id INNER JOIN skus s ON s.id = ol.sku_id WHERE ol.tenant_id = ? AND o.ordered_at >= ? AND o.ordered_at < ?${acosStoreFilter}${acosSkuFilter} GROUP BY ol.store_id, s.external_id) sales ON sales.store_id = a.storeId AND sales.sku COLLATE utf8mb4_unicode_ci = a.sku COLLATE utf8mb4_unicode_ci LEFT JOIN stores s ON s.id = a.storeId WHERE COALESCE(sales.sales, 0) > 0 ORDER BY (a.onsiteSpend + COALESCE(sem.semSpend, 0)) / sales.sales DESC LIMIT 10`, [tenantId, range.from, range.to, tenantId, range.from, range.to, tenantId, tenantId, bounds.from, bounds.to, ...(filters.storeId ? [filters.storeId] : allowedStores ?? []), ...(filters.skuId ? [filters.skuId] : [])]).catch(() => [[], undefined]) as Promise<[Array<{ sku: string | null; storeName: string; spend: string | number; sales: string | number }>, unknown]>;
    const [semDailyRows, [onsiteRows], [acosRows]] = await Promise.all([semDailyPromise, onsiteRowsPromise, acosRowsPromise]);
    const trendMap = new Map<string, { date: string; onsite: number; sem: number }>();
    for (const row of dedupeSemPerformanceRows(semDailyRows)) {
      const date = formatFactDate(row.factDate);
      const current = trendMap.get(date) ?? { date, onsite: 0, sem: 0 };
      current.sem += Number(row.spend ?? 0);
      trendMap.set(date, current);
    }
    for (const row of onsiteRows) {
      const date = formatFactDate(row.factDate);
      if (date < range.from || date > range.to) continue;
      const current = trendMap.get(date) ?? { date, onsite: 0, sem: 0 };
      current.onsite += Number(row.spend ?? 0);
      trendMap.set(date, current);
    }
    const adTrend = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const today = todayPacificDate();
    const monthPrefix = today.slice(0, 7);
    const todayRow = adTrend.find((row) => row.date === today);
    const monthRows = adTrend.filter((row) => row.date.startsWith(monthPrefix));
    const monthSpend = monthRows.reduce((sum, row) => sum + row.onsite + row.sem, 0);
    const highAcos = acosRows.map((row) => { const spend = Number(row.spend); const sales = Number(row.sales); return { sku: row.sku ?? '未填写 SKU', storeName: row.storeName, spend, sales, acos: spend / sales }; });
    return { stores: storesOut, stockoutRisk: risk, adSpend: { today: todayRow ? todayRow.onsite + todayRow.sem : null, month: monthRows.length ? monthSpend : null, trend: adTrend }, highAcos };
  };
}
export function dashboardOverview(rows: DashboardRow[], today = todayPacificDate(), useFilteredRows = false) {
  const metricRows = useFilteredRows ? rows : rows.filter((row) => row.date === today);
  const metrics = metricRows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, orders: a.orders + r.orders, units: a.units + r.units, refunds: a.refunds + (r.refunds ?? 0), profit: a.profit + (r.profit ?? 0) }), { revenue: 0, orders: 0, units: 0, refunds: 0, profit: 0 });
  return { metrics: { ...metrics, profitAvailable: metricRows.some(row => row.profit != null), estimated: metricRows.some((r) => r.estimated || r.profit == null) || metricRows.length === 0 }, today, trend: rows, rankings: [], freshness: rows.map((r) => r.refreshedAt).filter(Boolean).sort().at(-1) ?? null, formulaVersion: 'v1' };
}
export function dashboardRouter(list: (req: Request) => Promise<DashboardRow[]> = async () => [], extras?: (req: Request) => Promise<DashboardExtras>, visibility?: (req: Request) => Promise<{ tenantId?: string } | undefined>): Router { const r = Router(); const handler = async (req: Request, res: any, next: any) => { try { const rangeError = dateRangeError(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined); if (rangeError) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: rangeError } }); const scope = visibility ? await visibility(req) : undefined; if (visibility && !scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } }); const [rows, extraRows] = await Promise.all([list(req), extras?.(req)]); const hasDateFilter = Boolean(req.query.from || req.query.to); const data = dashboardOverview(rows, todayPacificDate(), hasDateFilter); if (extraRows) Object.assign(data, extraRows); return res.json({ requestId: res.locals.requestId, data, error: null }); } catch (e) { return next(e); } }; r.get('/dashboard', handler); r.get('/dashboard/overview', handler); return r; }
