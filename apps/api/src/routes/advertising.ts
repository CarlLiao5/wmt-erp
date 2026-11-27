import { Router, type Request } from 'express';
import { and, advertisingFacts, createDb, eq, gte, lte, semItemAdvertisingFacts, semPerformanceDaily, semSearchTermsDaily } from '@walmart-erp/db';
import { requestSession } from './auth.js';
import type { OrderVisibility } from './orders.js';
import { canViewStore, filterVisibleSkuRows } from './sku-visibility.js';
import { dateRangeError } from './date-range.js';
type AdvertisingVisibility = (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined;
export const mysqlTextEquals = (left: string, right: string) => `${left} COLLATE utf8mb4_unicode_ci = ${right} COLLATE utf8mb4_unicode_ci`;
export const onsiteDateExpression = (kind: 'onsite-keywords' | 'onsite-spend' | 'onsite-placement') => kind === 'onsite-keywords' ? "COALESCE(STR_TO_DATE(a.`Date`, '%Y/%c/%e'), STR_TO_DATE(a.`Date`, '%Y-%m-%d'))" : kind === 'onsite-placement' ? 'a.date' : 'a.report_date';
export interface AdvertisingListOptions {
  list?: (tenantId: string, storeId?: string, from?: string, to?: string, channel?: 'onsite' | 'sem') => Promise<any[]>;
  listSemItems?: (tenantId: string, storeId?: string, from?: string, to?: string, campaignId?: string, sku?: string) => Promise<any[]>;
  listSemPerformance?: (tenantId: string, storeId?: string, from?: string, to?: string, campaignId?: string, sku?: string) => Promise<any[]>;
  listSearchTerms?: (tenantId: string, storeId?: string, from?: string, to?: string, campaignId?: string, sku?: string, searchTerm?: string) => Promise<any[]>;
  listSemItemsPage?: (args: AdvertisingPageArgs) => Promise<AdvertisingPage>;
  listSearchTermsPage?: (args: AdvertisingPageArgs) => Promise<AdvertisingPage>;
  listOnsiteKeywordsPage?: (args: AdvertisingPageArgs) => Promise<AdvertisingPage>;
  listOnsiteSpendPage?: (args: AdvertisingPageArgs) => Promise<AdvertisingPage>;
  listOnsitePlacementPage?: (args: AdvertisingPageArgs) => Promise<AdvertisingPage>;
  visibility?: AdvertisingVisibility;
}
export interface AdvertisingPageArgs {
  tenantId: string; storeId?: string; from?: string; to?: string; q?: string;
  page: number; pageSize: number; scope?: OrderVisibility;
}
export interface AdvertisingPage { rows: any[]; total: number; page: number; pageSize: number; }
function dateConditions(column: any, from?: string, to?: string) { return [...(from ? [gte(column, from)] : []), ...(to ? [lte(column, to)] : [])]; }
export function mysqlAdvertisingSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string, channel?: 'onsite' | 'sem') => { const { db, pool } = createDb(); try { const conditions = [eq(advertisingFacts.tenantId, tenantId), ...(storeId ? [eq(advertisingFacts.storeId, storeId)] : []), ...(channel ? [eq(advertisingFacts.channel, channel)] : []), ...dateConditions(advertisingFacts.factDate, from, to)]; const facts = await db.select().from(advertisingFacts).where(and(...conditions)); if (channel === 'sem') return dedupeSemAdvertisingFacts(facts); const [rows] = await pool.query(`SELECT a.report_date AS factDate, a.store_name AS storeName, s.id AS storeId, a.advertiser_id AS advertiserId, a.msku AS sku, a.item_id AS itemId, a.campaign_id AS campaignId, a.campaign_name AS campaignName, a.ad_group_id AS adGroupId, a.ad_group_name AS adGroupName, a.impressions, a.clicks, a.spend, a.sales AS attributedSales, a.orders, a.units, a.acos, a.roas, a.cvr, 'onsite' AS channel, 1 AS complete FROM ad_item_report a LEFT JOIN stores s ON s.tenant_id = ? AND s.name COLLATE utf8mb4_unicode_ci = a.store_name COLLATE utf8mb4_unicode_ci WHERE (? IS NULL OR a.report_date >= ?) AND (? IS NULL OR a.report_date <= ?) AND (? IS NULL OR s.id = ?)`, [tenantId, from ?? null, from ?? null, to ?? null, to ?? null, storeId ?? null, storeId ?? null]) as [Array<Record<string, unknown>>, unknown]; return [...facts, ...rows.map((row) => ({ ...row, tenantId, source: 'ad_item_report' }))]; } finally { await pool.end(); } }; }
export function mysqlSemItemAdvertisingSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string, campaignId?: string, sku?: string) => { const { db, pool } = createDb(); try { const conditions = [eq(semItemAdvertisingFacts.tenantId, tenantId), ...(storeId ? [eq(semItemAdvertisingFacts.storeId, storeId)] : []), ...(campaignId ? [eq(semItemAdvertisingFacts.campaignId, campaignId)] : []), ...(sku ? [eq(semItemAdvertisingFacts.sku, sku)] : []), ...dateConditions(semItemAdvertisingFacts.factDate, from, to)]; return await db.select().from(semItemAdvertisingFacts).where(and(...conditions)); } finally { await pool.end(); } }; }
export function mysqlSemPerformanceSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string, campaignId?: string, sku?: string) => { const { db, pool } = createDb(); try { const conditions = [eq(semPerformanceDaily.tenantId, tenantId), ...(storeId ? [eq(semPerformanceDaily.storeId, storeId)] : []), ...(campaignId ? [eq(semPerformanceDaily.campaignId, campaignId)] : []), ...(sku ? [eq(semPerformanceDaily.sku, sku)] : []), ...dateConditions(semPerformanceDaily.reportDate, from, to)]; return await db.select().from(semPerformanceDaily).where(and(...conditions)); } finally { await pool.end(); } }; }
export function mysqlSemSearchTermsSource() { return async (tenantId: string, storeId?: string, from?: string, to?: string, campaignId?: string, sku?: string, searchTerm?: string) => { const { db, pool } = createDb(); try { const conditions = [eq(semSearchTermsDaily.tenantId, tenantId), ...(storeId ? [eq(semSearchTermsDaily.storeId, storeId)] : []), ...(campaignId ? [eq(semSearchTermsDaily.campaignId, campaignId)] : []), ...(sku ? [eq(semSearchTermsDaily.sku, sku)] : []), ...(searchTerm ? [eq(semSearchTermsDaily.searchTerm, searchTerm)] : []), ...dateConditions(semSearchTermsDaily.reportDate, from, to)]; return await db.select().from(semSearchTermsDaily).where(and(...conditions)); } finally { await pool.end(); } }; }
const pageArgs = (req: Request, scope: OrderVisibility, storeId?: string): AdvertisingPageArgs => ({ tenantId: String(scope.tenantId), storeId, from: stringQuery(req, 'from'), to: stringQuery(req, 'to'), q: stringQuery(req, 'q'), page: Math.max(1, Number(req.query.page) || 1), pageSize: Math.min(1000, Math.max(1, Number(req.query.pageSize) || 20)), scope });
const scopeSql = (scope: OrderVisibility | undefined, alias = 's', skuExpr = 'm.sku') => {
  if (!scope || scope.role === 'admin') return { sql: '', params: [] as string[] };
  const stores = [...scope.storeIds];
  const grants = [...scope.skus].map((grant) => { const i = grant.indexOf(':'); return i < 0 ? undefined : { storeId: grant.slice(0, i), sku: grant.slice(i + 1) }; }).filter((x): x is { storeId: string; sku: string } => Boolean(x));
  const clauses: string[] = [];
  const params: string[] = [];
  if (stores.length) { clauses.push(`${alias}.id IN (${stores.map(() => '?').join(',')})`); params.push(...stores); }
  for (const grant of grants) { clauses.push(`(${alias}.id = ? AND ${skuExpr} = ?)`); params.push(grant.storeId, grant.sku); }
  return { sql: clauses.length ? ` AND (${clauses.join(' OR ')})` : ' AND 1=0', params };
};
async function resolveProductSearch(pool: any, tenantId: string, storeId: string | undefined, query: string | undefined) {
  const term = query?.trim();
  if (!term) return null;
  const like = `%${term}%`;
  const storeSql = storeId ? ' AND store_id = ?' : '';
  const tenantStoreParams: string[] = storeId ? [tenantId, storeId] : [tenantId];
  const [rows] = await pool.query(`SELECT storeId, sku, itemId FROM (
    SELECT s.store_id AS storeId, s.external_id AS sku, s.item_id AS itemId FROM skus s WHERE s.tenant_id = ?${storeSql} AND (s.external_id LIKE ? OR s.item_id LIKE ? OR s.title LIKE ?)
    UNION DISTINCT
    SELECT p.store_id AS storeId, p.sku, p.item_id AS itemId FROM sem_item_advertising_facts p WHERE p.tenant_id = ?${storeId ? ' AND p.store_id = ?' : ''} AND (p.sku LIKE ? OR p.item_id LIKE ?)
    UNION DISTINCT
    SELECT t.store_id AS storeId, t.sku, t.item_id AS itemId FROM sem_search_terms_daily t WHERE t.tenant_id = ?${storeId ? ' AND t.store_id = ?' : ''} AND (t.sku LIKE ? OR t.item_id LIKE ?)
  ) product_aliases`, [...tenantStoreParams, like, like, like, ...tenantStoreParams, like, like, ...tenantStoreParams, like, like]) as [Array<{ storeId: string; sku: string; itemId?: string | null }>, unknown];
  return rows;
}
async function rawPage(args: AdvertisingPageArgs, kind: 'sem-items' | 'sem-search' | 'onsite-keywords' | 'onsite-spend' | 'onsite-placement'): Promise<AdvertisingPage> {
  const { pool } = createDb();
  try {
    const limit = Math.min(kind === 'sem-search' ? 1000 : 100, args.pageSize), offset = (args.page - 1) * limit, params: Array<string | number | null> = [args.tenantId];
    let select = '', from = '', where = ' WHERE 1=1', order = '';
    const search = args.q?.trim();
    const products = search ? await resolveProductSearch(pool, args.tenantId, args.storeId, search) : null;
    if (kind === 'sem-items') {
      select = 'm.*, m.store_id AS storeId, m.fact_date AS factDate, m.period_start AS periodStart, m.period_end AS periodEnd, m.attributed_sales AS attributedSales, s.name AS storeName, k.title AS productName'; from = ` FROM sem_item_advertising_facts m INNER JOIN stores s ON s.tenant_id = ? AND s.id = m.store_id LEFT JOIN skus k ON k.tenant_id = m.tenant_id AND k.store_id = m.store_id AND (${mysqlTextEquals('k.external_id', 'm.sku')} OR ${mysqlTextEquals('k.item_id', 'm.item_id')})`;
      where += ' AND m.tenant_id = ?'; params.push(args.tenantId); if (args.storeId) { where += ' AND s.id = ?'; params.push(args.storeId); } if (args.from) { where += ' AND m.fact_date >= ?'; params.push(args.from); } if (args.to) { where += ' AND m.fact_date <= ?'; params.push(args.to); } if (search) { where += products?.length ? ` AND (${products.map(() => '(m.store_id = ? AND (m.sku = ? OR m.item_id = ?))').join(' OR ')} OR m.sku LIKE ? OR m.item_id LIKE ? OR m.campaign_id LIKE ? OR k.title LIKE ?)` : ' AND (m.sku LIKE ? OR m.item_id LIKE ? OR m.campaign_id LIKE ? OR k.title LIKE ?)'; if (products?.length) params.push(...products.flatMap(product => [product.storeId, product.sku, product.itemId ?? '']), ...Array(4).fill(`%${search}%`)); else params.push(...Array(4).fill(`%${search}%`)); } order = ' ORDER BY m.fact_date DESC, m.id DESC';
    } else if (kind === 'sem-search') {
      select = 'm.*, m.store_id AS storeId, m.report_date AS reportDate, m.campaign_id AS campaignId, m.campaign_name AS campaignName, m.search_term AS searchTerm, m.item_id AS itemId, m.ad_spend AS adSpend, s.name AS storeName, k.title AS productName'; from = ` FROM sem_search_terms_daily m INNER JOIN stores s ON s.id = m.store_id AND s.tenant_id = ? LEFT JOIN skus k ON k.tenant_id = m.tenant_id AND k.store_id = m.store_id AND (${mysqlTextEquals('k.external_id', 'm.sku')} OR ${mysqlTextEquals('k.item_id', 'm.item_id')})`;
      where += ' AND m.tenant_id = ?'; params.push(args.tenantId); if (args.storeId) { where += ' AND s.id = ?'; params.push(args.storeId); } if (args.from) { where += ' AND m.report_date >= ?'; params.push(args.from); } if (args.to) { where += ' AND m.report_date <= ?'; params.push(args.to); } if (search) { where += products?.length ? ` AND (${products.map(() => '(m.store_id = ? AND (m.sku = ? OR m.item_id = ?))').join(' OR ')} OR m.sku LIKE ? OR m.item_id LIKE ? OR m.campaign_id LIKE ? OR m.campaign_name LIKE ? OR m.search_term LIKE ?)` : ' AND (m.sku LIKE ? OR m.item_id LIKE ? OR m.campaign_id LIKE ? OR m.campaign_name LIKE ? OR m.search_term LIKE ?)'; if (products?.length) params.push(...products.flatMap(product => [product.storeId, product.sku, product.itemId ?? '']), ...Array(5).fill(`%${search}%`)); else params.push(...Array(5).fill(`%${search}%`)); } order = ' ORDER BY m.report_date DESC, m.id DESC';
    } else {
      const isKeyword = kind === 'onsite-keywords'; const isPlacement = kind === 'onsite-placement'; const table = isKeyword ? 'ad_keyword_report a' : isPlacement ? 'ad_Placement a' : 'ad_item_report a';
      const date = onsiteDateExpression(kind);
      const brandColumn = isPlacement ? 'a.brand' : 'a.store_name';
      const storeJoin = `INNER JOIN stores s ON s.tenant_id = ? AND (s.name COLLATE utf8mb4_unicode_ci = ${brandColumn} COLLATE utf8mb4_unicode_ci OR (${brandColumn} COLLATE utf8mb4_unicode_ci = '鑫起典沃尔玛' COLLATE utf8mb4_unicode_ci AND s.name COLLATE utf8mb4_unicode_ci = '鑫启典沃尔玛' COLLATE utf8mb4_unicode_ci))`;
      params.length = 0; params.push(args.tenantId);
      if (isKeyword) select = 'a.*, s.id AS storeId, s.name AS storeName, a.`Item Name` AS productName, a.`Item Id` AS itemId, a.`Searched Keyword` AS searchTerm, a.`Ad Spend` AS spend'; else if (isPlacement) select = 'a.*, s.id AS storeId, s.name AS storeName, a.product_id AS itemId'; else select = 'a.*, s.id AS storeId, s.name AS storeName, a.msku AS sku, a.product_title AS productName';
      const skuJoin = isKeyword ? ` LEFT JOIN skus k ON k.tenant_id = ? AND k.store_id = s.id AND (${mysqlTextEquals('k.item_id', 'a.`Item Id`')} OR ${mysqlTextEquals('k.external_id', 'a.`Item Id`')})` : isPlacement ? ` LEFT JOIN skus k ON k.tenant_id = ? AND k.store_id = s.id AND (${mysqlTextEquals('k.item_id', 'a.product_id')} OR ${mysqlTextEquals('k.external_id', 'a.product_id')})` : ` LEFT JOIN skus k ON k.tenant_id = ? AND k.store_id = s.id AND (${mysqlTextEquals('k.external_id', 'a.msku')} OR ${mysqlTextEquals('k.item_id', 'a.item_id')})`;
      params.push(args.tenantId); from = ` FROM ${table} ${storeJoin}${skuJoin}`; where = ' WHERE 1=1'; if (args.storeId) { where += ' AND s.id = ?'; params.push(args.storeId); } if (args.from) { where += ` AND ${date} >= ?`; params.push(args.from); } if (args.to) { where += ` AND ${date} <= ?`; params.push(args.to); } if (search) { const fields = isKeyword ? ['a.`Item Id`','a.`Item Name`','a.`Searched Keyword`','a.`Campaign Name`','a.`Campaign Id`','k.title'] : isPlacement ? ['a.product_id','a.placement','a.brand','k.title'] : ['a.msku','a.item_id','a.product_title','a.campaign_name','a.campaign_id','k.title']; const aliasMatch = isKeyword ? '(a.`Item Id` = ? OR a.`Item Name` = ?)' : isPlacement ? '(a.product_id = ?)' : '(a.msku = ? OR a.item_id = ?)'; const productMatch = products?.length ? ` OR ${products.map(() => `(s.id = ? AND ${aliasMatch})`).join(' OR ')}` : ''; where += ` AND (${fields.map((field) => `${field} LIKE ?`).join(' OR ')}${productMatch})`; params.push(...fields.map(() => `%${search}%`)); if (products?.length) params.push(...products.flatMap(product => isKeyword ? [product.storeId, product.itemId ?? product.sku, product.sku] : isPlacement ? [product.storeId, product.itemId ?? product.sku] : [product.storeId, product.sku, product.itemId ?? product.sku])); } order = ` ORDER BY ${date} DESC, ${isKeyword ? 'a.`Item Id`' : 'a.id'} DESC`;
    }
    const scoped = scopeSql(args.scope, 's', kind === 'onsite-keywords' ? 'k.external_id' : kind === 'onsite-placement' ? 'a.product_id' : kind === 'onsite-spend' ? 'a.msku' : 'm.sku'); where += scoped.sql; params.push(...scoped.params);
    const countParams = [...params]; const [countRows] = await pool.query(`SELECT COUNT(*) AS total${from}${where}`, countParams) as [Array<{ total: number | string }>, unknown];
    const [rows] = await pool.query(`SELECT ${select}${from}${where}${order} LIMIT ? OFFSET ?`, [...params, limit, offset]) as [any[], unknown];
    return { rows, total: Number(countRows[0]?.total ?? 0), page: args.page, pageSize: limit };
  } finally { await pool.end(); }
}
export const mysqlSemItemsPage = (args: AdvertisingPageArgs) => rawPage(args, 'sem-items');
export const mysqlSemSearchTermsPage = (args: AdvertisingPageArgs) => rawPage(args, 'sem-search');
export const mysqlOnsiteKeywordsPage = (args: AdvertisingPageArgs) => rawPage(args, 'onsite-keywords');
export const mysqlOnsiteSpendPage = (args: AdvertisingPageArgs) => rawPage(args, 'onsite-spend');
export const mysqlOnsitePlacementPage = (args: AdvertisingPageArgs) => rawPage(args, 'onsite-placement');
export async function mysqlOnsiteSpendTrend(args: Omit<AdvertisingPageArgs, 'page' | 'pageSize'>) {
  const { pool } = createDb();
  try {
    const products = await resolveProductSearch(pool, args.tenantId, args.storeId, args.q);
    const params: Array<string> = [args.tenantId];
    let where = ' WHERE 1=1';
    if (args.storeId) { where += ' AND s.id = ?'; params.push(args.storeId); }
    if (args.from) { where += ' AND a.report_date >= ?'; params.push(args.from); }
    if (args.to) { where += ' AND a.report_date <= ?'; params.push(args.to); }
    if (args.q?.trim()) {
      if (products?.length) {
        where += ` AND (${products.map(() => `(s.id = ? AND (a.msku = ? OR a.item_id = ?))`).join(' OR ')} OR a.msku LIKE ? OR a.item_id LIKE ? OR a.product_title LIKE ? OR a.campaign_name LIKE ? OR a.campaign_id LIKE ?)`;
        params.push(...products.flatMap(product => [product.storeId, product.sku, product.itemId ?? '']), ...Array(5).fill(`%${args.q.trim()}%`));
      } else {
        where += ' AND (a.msku LIKE ? OR a.item_id LIKE ? OR a.product_title LIKE ? OR a.campaign_name LIKE ? OR a.campaign_id LIKE ?)';
        params.push(...Array(5).fill(`%${args.q.trim()}%`));
      }
    }
    const scoped = scopeSql(args.scope, 's', 'a.msku'); where += scoped.sql; params.push(...scoped.params);
    const [onsiteRows] = await pool.query(`SELECT a.report_date AS date, SUM(a.spend) AS spend, 'onsite' AS channel FROM ad_item_report a INNER JOIN stores s ON s.tenant_id = ? AND (${mysqlTextEquals('s.name', 'a.store_name')} OR (${mysqlTextEquals('a.store_name', "'鑫起典沃尔玛'")} AND ${mysqlTextEquals('s.name', "'鑫启典沃尔玛'")}))${where} GROUP BY a.report_date`, params) as [Array<{ date: string; spend: string | number | null; channel: string }>, unknown];
    const semParams: Array<string> = [args.tenantId]; let semWhere = ' WHERE p.tenant_id = ?';
    if (args.storeId) { semWhere += ' AND s.id = ?'; semParams.push(args.storeId); }
    if (args.from) { semWhere += ' AND p.report_date >= ?'; semParams.push(args.from); }
    if (args.to) { semWhere += ' AND p.report_date <= ?'; semParams.push(args.to); }
    if (args.q?.trim()) {
      if (products?.length) {
        semWhere += ` AND (${products.map(() => '(p.store_id = ? AND (p.sku = ? OR p.item_id = ?))').join(' OR ')} OR p.sku LIKE ? OR p.item_id LIKE ? OR p.campaign_id LIKE ? OR p.campaign_name LIKE ?)`;
        semParams.push(...products.flatMap(product => [product.storeId, product.sku, product.itemId ?? '']), ...Array(4).fill(`%${args.q.trim()}%`));
      } else {
        semWhere += ' AND (p.sku LIKE ? OR p.item_id LIKE ? OR p.campaign_id LIKE ? OR p.campaign_name LIKE ?)';
        semParams.push(...Array(4).fill(`%${args.q.trim()}%`));
      }
    }
    const semScoped = scopeSql(args.scope, 's', 'p.sku'); semWhere += semScoped.sql; semParams.push(...semScoped.params);
    const [semRows] = await pool.query(`SELECT p.report_date AS date, SUM(p.ad_spend) AS spend, 'sem' AS channel FROM sem_performance_daily p INNER JOIN (SELECT store_id, report_date, campaign_id, sku, MAX(received_at) AS received_at FROM sem_performance_daily GROUP BY store_id, report_date, campaign_id, sku) latest ON latest.store_id = p.store_id AND latest.report_date = p.report_date AND latest.campaign_id = p.campaign_id AND latest.sku = p.sku AND latest.received_at = p.received_at INNER JOIN stores s ON s.tenant_id = p.tenant_id AND s.id = p.store_id${semWhere} GROUP BY p.report_date`, semParams) as [Array<{ date: string; spend: string | number | null; channel: string }>, unknown];
    return [...onsiteRows, ...semRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  } finally { await pool.end(); }
}
export function advertisingMetrics(rows: Array<{ spend?: unknown; attributedSales?: unknown; complete?: number }>) { const spend = rows.reduce((sum, row) => sum + (row.spend == null ? 0 : Number(row.spend)), 0); const salesValues = rows.filter((row) => row.attributedSales != null).map((row) => Number(row.attributedSales)); const attributedSales = salesValues.length ? salesValues.reduce((sum, value) => sum + value, 0) : null; return { spend, attributedSales, acos: attributedSales != null && attributedSales !== 0 ? spend / attributedSales : null, roas: attributedSales != null && spend !== 0 ? attributedSales / spend : null, complete: rows.length > 0 && rows.every((row) => row.complete === 1) }; }
export function filterVisibleAdvertisingRows<T extends { storeId?: string | null; sku?: string | null }>(rows: T[], scope: OrderVisibility): T[] {
  if (scope.role === 'admin') return rows;
  return rows.filter((row) => {
    if (!row.storeId) return false;
    if (scope.storeIds.has(row.storeId)) return true;
    return typeof row.sku === 'string' && filterVisibleSkuRows([{ storeId: row.storeId, sku: row.sku }], scope).length > 0;
  });
}
const stringQuery = (req: Request, name: string) => typeof req.query[name] === 'string' ? req.query[name] as string : undefined;
const filterByRequestedSku = <T extends { sku?: unknown }>(rows: T[], sku?: string) =>
  sku ? rows.filter((row) => typeof row.sku === 'string' && row.sku.trim().toLocaleUpperCase('en-US') === sku.trim().toLocaleUpperCase('en-US')) : rows;

async function routeContext(req: Request, res: any, visibility?: AdvertisingVisibility) {
  const session = await requestSession(req);
  if (!session?.tenantId) { res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } }); return undefined; }
  const scope = visibility ? await visibility(req) : undefined;
  if (!scope) { res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } }); return undefined; }
  const storeId = stringQuery(req, 'storeId');
  if (storeId && scope.role !== 'admin' && !canViewStore(scope, storeId)) { res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } }); return undefined; }
  return { session, scope, storeId };
}

function emptyAdvertisingMetrics() { return { spend: null, attributedSales: null, acos: null, roas: null, complete: false }; }

export function dedupeSemAdvertisingFacts<T extends { storeId: string; factDate: Date | string; campaignId?: string | null; receivedAt: Date | string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const date = row.factDate instanceof Date ? row.factDate.toISOString().slice(0, 10) : String(row.factDate).slice(0, 10);
    const key = `${row.storeId}\u0000${date}\u0000${row.campaignId ?? ''}`;
    const previous = latest.get(key);
    if (!previous || new Date(row.receivedAt).getTime() > new Date(previous.receivedAt).getTime()) latest.set(key, row);
  }
  return [...latest.values()];
}

export function advertisingRouter(options: AdvertisingListOptions = {}): Router {
  const r = Router();
  const validateRange = (req: Request, res: any) => {
    const error = dateRangeError(stringQuery(req, 'from'), stringQuery(req, 'to'));
    return error ? res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: error } }) : null;
  };
  r.get('/advertising', async (req, res, next) => {
    try {
      const invalidRange = validateRange(req, res); if (invalidRange) return invalidRange;
      const context = await routeContext(req, res, options.visibility); if (!context) return;
      const channel = req.query.channel === 'sem' || req.query.channel === 'onsite' ? req.query.channel : undefined;
      const rows = await (options.list ?? mysqlAdvertisingSource())(context.session.tenantId, context.storeId, stringQuery(req, 'from'), stringQuery(req, 'to'), channel);
      const visible = filterVisibleAdvertisingRows(rows, context.scope);
      return res.json({ requestId: res.locals.requestId, data: { rows: visible, metrics: visible.length ? advertisingMetrics(visible) : emptyAdvertisingMetrics(), dataAvailable: visible.length > 0, source: channel ?? 'walmart', channel }, error: null });
    } catch (e) { return next(e); }
  });

  r.get('/advertising/items', async (req, res, next) => {
    try {
      const invalidRange = validateRange(req, res); if (invalidRange) return invalidRange;
      const context = await routeContext(req, res, options.visibility); if (!context) return;
      if (options.listSemItemsPage || !options.listSemItems) {
        const result = await (options.listSemItemsPage ?? mysqlSemItemsPage)(pageArgs(req, context.scope, context.storeId));
        return res.json({ requestId: res.locals.requestId, data: { ...result, dataAvailable: result.total > 0, source: 'sem-items', channel: 'sem' }, error: null });
      }
      const rows = await options.listSemItems(context.session.tenantId, context.storeId, stringQuery(req, 'from'), stringQuery(req, 'to'), stringQuery(req, 'campaignId'), stringQuery(req, 'sku'));
      const visible = filterByRequestedSku(context.scope.role === 'admin' ? rows : filterVisibleSkuRows(rows, context.scope), stringQuery(req, 'sku'));
      return res.json({ requestId: res.locals.requestId, data: { rows: visible, dataAvailable: visible.length > 0, source: 'sem-items', channel: 'sem' }, error: null });
    } catch (e) { return next(e); }
  });

  r.get('/advertising/performance', async (req, res, next) => {
    try {
      const invalidRange = validateRange(req, res); if (invalidRange) return invalidRange;
      const context = await routeContext(req, res, options.visibility); if (!context) return;
      const rows = await (options.listSemPerformance ?? mysqlSemPerformanceSource())(context.session.tenantId, context.storeId, stringQuery(req, 'from'), stringQuery(req, 'to'), stringQuery(req, 'campaignId'), stringQuery(req, 'sku'));
      const visible = filterByRequestedSku(context.scope.role === 'admin' ? rows : filterVisibleSkuRows(rows, context.scope), stringQuery(req, 'sku'));
      return res.json({ requestId: res.locals.requestId, data: { rows: visible, dataAvailable: visible.length > 0, source: 'SEM_PERFORMANCE', channel: 'sem' }, error: null });
    } catch (e) { return next(e); }
  });

  r.get('/advertising/search-terms', async (req, res, next) => {
    try {
      const invalidRange = validateRange(req, res); if (invalidRange) return invalidRange;
      const context = await routeContext(req, res, options.visibility); if (!context) return;
      if (options.listSearchTermsPage || !options.listSearchTerms) {
        const result = await (options.listSearchTermsPage ?? mysqlSemSearchTermsPage)(pageArgs(req, context.scope, context.storeId));
        return res.json({ requestId: res.locals.requestId, data: { ...result, dataAvailable: result.total > 0, source: 'SEM_SEARCH_TERMS', channel: 'sem' }, error: null });
      }
      const rows = await options.listSearchTerms(context.session.tenantId, context.storeId, stringQuery(req, 'from'), stringQuery(req, 'to'), stringQuery(req, 'campaignId'), stringQuery(req, 'sku'), stringQuery(req, 'searchTerm'));
      const visible = filterByRequestedSku(context.scope.role === 'admin' ? rows : filterVisibleSkuRows(rows, context.scope), stringQuery(req, 'sku'));
      return res.json({ requestId: res.locals.requestId, data: { rows: visible, dataAvailable: visible.length > 0, source: 'SEM_SEARCH_TERMS', channel: 'sem' }, error: null });
    } catch (e) { return next(e); }
  });
  const onsitePageRoute = (path: string, source: (args: AdvertisingPageArgs) => Promise<AdvertisingPage>, option: keyof AdvertisingListOptions) => r.get(path, async (req, res, next) => {
    try {
      const invalidRange = validateRange(req, res); if (invalidRange) return invalidRange;
      const context = await routeContext(req, res, options.visibility); if (!context) return;
      const result = await ((options[option] as ((args: AdvertisingPageArgs) => Promise<AdvertisingPage>) | undefined) ?? source)(pageArgs(req, context.scope, context.storeId));
      return res.json({ requestId: res.locals.requestId, data: { ...result, dataAvailable: result.total > 0, source: path.slice(1), channel: 'onsite' }, error: null });
    } catch (e) { return next(e); }
  });
  onsitePageRoute('/advertising/onsite/keywords', mysqlOnsiteKeywordsPage, 'listOnsiteKeywordsPage');
  onsitePageRoute('/advertising/onsite/spend', mysqlOnsiteSpendPage, 'listOnsiteSpendPage');
  onsitePageRoute('/advertising/onsite/placement', mysqlOnsitePlacementPage, 'listOnsitePlacementPage');
  r.get('/advertising/onsite/spend-trend', async (req, res, next) => {
    try {
      const invalidRange = validateRange(req, res); if (invalidRange) return invalidRange;
      const context = await routeContext(req, res, options.visibility); if (!context) return;
      const rows = await mysqlOnsiteSpendTrend(pageArgs(req, context.scope, context.storeId));
      return res.json({ requestId: res.locals.requestId, data: { rows, dataAvailable: rows.length > 0, source: 'onsite-spend-trend', channel: 'onsite' }, error: null });
    } catch (e) { return next(e); }
  });
  return r;
}
