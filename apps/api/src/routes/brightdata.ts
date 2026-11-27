import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { and, brightdataItemNames, brightdataProductInventory, brightdataSyncSchedules, createDb, eq, gte, inArray, like, lte, or } from '@walmart-erp/db';
import { BRIGHTDATA_SCHEDULE_TIME_ZONE, nextBrightDataRunAt } from '@walmart-erp/domain';
import { requestSession } from './auth.js';
import type { OrderVisibility } from './orders.js';

export interface BrightDataInventoryRow {
  id: string;
  tenantId: string;
  storeId?: string | null;
  sourceItemId?: string | null;
  itemId: string;
  runId: string;
  productName?: string | null;
  availableQuantity?: number | null;
  queriedAt: string | Date;
  price?: string | number | null;
  description?: string | null;
  rating?: string | number | null;
  reviewCount?: number | null;
  rawPayload?: unknown;
  createdAt?: string | Date;
}

export interface BrightDataItemRow {
  id: string;
  tenantId: string;
  storeId?: string | null;
  itemId: string;
  sourceRowId?: string | null;
  rawPayload?: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
  productName?: string | null;
}

export interface BrightDataFilters {
  q?: string;
  itemId?: string;
  itemIds?: string[];
  productName?: string;
  from?: string;
  to?: string;
}
export interface BrightDataCreateItemInput { itemId: string; productName: string; category: string; }
export interface BrightDataScheduleState { enabled: boolean; timezone: string; nextRunAt: string | null; lastRunAt: string | null; }

export type BrightDataVisibility = (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined;
export interface BrightDataRouterOptions {
  search?: (tenantId: string, query: string) => Promise<{ items: BrightDataItemRow[]; inventory: BrightDataInventoryRow[] }>;
  inventory?: (tenantId: string, filters?: BrightDataFilters) => Promise<BrightDataInventoryRow[]>;
  items?: (tenantId: string, filters?: BrightDataFilters) => Promise<BrightDataItemRow[]>;
  createItem?: (tenantId: string, input: BrightDataCreateItemInput) => Promise<BrightDataItemRow>;
  createItems?: (tenantId: string, inputs: BrightDataCreateItemInput[]) => Promise<{ created: BrightDataItemRow[]; skipped: string[] }>;
  schedule?: (tenantId: string) => Promise<BrightDataScheduleState>;
  setSchedule?: (tenantId: string, enabled: boolean) => Promise<BrightDataScheduleState>;
  visibility?: BrightDataVisibility;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value);
}

function readFilters(req: Request): BrightDataFilters {
  return {
    q: typeof req.query.q === 'string' ? req.query.q.trim() || undefined : undefined,
    itemId: typeof req.query.itemId === 'string' ? req.query.itemId.trim() || undefined : undefined,
    itemIds: typeof req.query.itemIds === 'string' ? [...new Set(req.query.itemIds.split(',').map((itemId) => itemId.trim()).filter(Boolean))].slice(0, 50) : undefined,
    productName: typeof req.query.productName === 'string' ? req.query.productName.trim() || undefined : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  };
}

function paginate<T>(rows: T[], req: Request): { rows: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } } {
  const requestedPage = Number(req.query.page ?? 1);
  const requestedPageSize = Number(req.query.pageSize ?? 20);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
  const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? Math.min(100, Math.floor(requestedPageSize)) : 20;
  const total = rows.length;
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

function filterInventory(rows: BrightDataInventoryRow[], filters: BrightDataFilters): BrightDataInventoryRow[] {
  const from = parseDate(filters.from);
  const to = parseDate(filters.to);
  const toInclusive = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;
  return rows.filter((row) => {
    const queriedAt = new Date(row.queriedAt).getTime();
    return (!filters.itemId || row.itemId.toLocaleLowerCase().includes(filters.itemId.toLocaleLowerCase()))
      && (!filters.itemIds?.length || filters.itemIds.includes(row.itemId))
      && (!filters.productName || String(row.productName ?? '').toLocaleLowerCase().includes(filters.productName.toLocaleLowerCase()))
      && (!from || queriedAt >= from.getTime())
      && (!toInclusive || queriedAt <= toInclusive.getTime());
  }).sort((a, b) => new Date(b.queriedAt).getTime() - new Date(a.queriedAt).getTime());
}

function filterItems(rows: BrightDataItemRow[], filters: BrightDataFilters): BrightDataItemRow[] {
  return rows.filter((row) => (!filters.q || `${row.itemId} ${row.productName ?? ''}`.toLocaleLowerCase().includes(filters.q.toLocaleLowerCase()))
    && (!filters.itemId || row.itemId.toLocaleLowerCase().includes(filters.itemId.toLocaleLowerCase()))
    && (!filters.productName || String(row.productName ?? '').toLocaleLowerCase().includes(filters.productName.toLocaleLowerCase())))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function mysqlBrightDataInventorySource() {
  return async (tenantId: string, filters: BrightDataFilters = {}): Promise<BrightDataInventoryRow[]> => {
    const { db, pool } = createDb();
    try {
      const conditions = [eq(brightdataProductInventory.tenantId, tenantId)];
      if (filters.itemId) conditions.push(eq(brightdataProductInventory.itemId, filters.itemId));
      if (filters.itemIds?.length) conditions.push(inArray(brightdataProductInventory.itemId, filters.itemIds));
      const from = parseDate(filters.from); if (from) conditions.push(gte(brightdataProductInventory.queriedAt, from));
      const to = parseDate(filters.to); if (to) conditions.push(lte(brightdataProductInventory.queriedAt, new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)));
      const rows = await db.select().from(brightdataProductInventory).where(and(...conditions));
      return filterInventory(rows, filters);
    } finally { await pool.end(); }
  };
}

export function mysqlBrightDataSearchSource() {
  return async (tenantId: string, query: string): Promise<{ items: BrightDataItemRow[]; inventory: BrightDataInventoryRow[] }> => {
    const { db, pool } = createDb();
    try {
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      const itemCondition = or(like(brightdataItemNames.itemId, pattern), like(brightdataItemNames.productName, pattern));
      const items = itemCondition
        ? await db.select().from(brightdataItemNames).where(and(eq(brightdataItemNames.tenantId, tenantId), itemCondition)).limit(50)
        : [];
      const itemIds = items.map((item) => item.itemId);
      const inventoryRows = itemIds.length
        ? await db.select().from(brightdataProductInventory).where(and(eq(brightdataProductInventory.tenantId, tenantId), inArray(brightdataProductInventory.itemId, itemIds)))
        : /^\S{5,}$/.test(query)
          ? await db.select().from(brightdataProductInventory).where(and(eq(brightdataProductInventory.tenantId, tenantId), eq(brightdataProductInventory.itemId, query)))
          : [];
      return { items, inventory: filterInventory(inventoryRows, {}) };
    } finally { await pool.end(); }
  };
}

export function mysqlBrightDataItemsSource() {
  return async (tenantId: string, filters: BrightDataFilters = {}): Promise<BrightDataItemRow[]> => {
    const { db, pool } = createDb();
    try {
      const conditions = [eq(brightdataItemNames.tenantId, tenantId)];
      if (filters.itemId) conditions.push(eq(brightdataItemNames.itemId, filters.itemId));
      if (filters.q) {
        const pattern = `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`;
        const searchCondition = or(like(brightdataItemNames.itemId, pattern), like(brightdataItemNames.productName, pattern));
        if (searchCondition) conditions.push(searchCondition);
      }
      const rows = await db.select().from(brightdataItemNames).where(and(...conditions));
      return filterItems(rows, filters);
    } finally { await pool.end(); }
  };
}

export function mysqlBrightDataCreateItem() {
  return async (tenantId: string, input: BrightDataCreateItemInput): Promise<BrightDataItemRow> => {
    const { db, pool } = createDb();
    try {
      const now = new Date();
      const id = randomUUID();
      const rawPayload = input.category ? { category: input.category } : null;
      await db.insert(brightdataItemNames).values({ id, tenantId, itemId: input.itemId, productName: input.productName, rawPayload, createdAt: now, updatedAt: now });
      return { id, tenantId, itemId: input.itemId, productName: input.productName, rawPayload, createdAt: now, updatedAt: now };
    } finally { await pool.end(); }
  };
}

export function mysqlBrightDataScheduleSource() {
  return async (tenantId: string): Promise<BrightDataScheduleState> => {
    const { db, pool } = createDb();
    try {
      const [row] = await db.select().from(brightdataSyncSchedules).where(eq(brightdataSyncSchedules.tenantId, tenantId)).limit(1);
      return row ? { enabled: Boolean(row.enabled), timezone: row.timezone, nextRunAt: row.nextRunAt?.toISOString() ?? null, lastRunAt: row.lastRunAt?.toISOString() ?? null } : { enabled: false, timezone: BRIGHTDATA_SCHEDULE_TIME_ZONE, nextRunAt: null, lastRunAt: null };
    } finally { await pool.end(); }
  };
}

export function mysqlBrightDataScheduleUpdater(now: () => Date = () => new Date()) {
  return async (tenantId: string, enabled: boolean): Promise<BrightDataScheduleState> => {
    const { db, pool } = createDb();
    try {
      const current = now();
      const nextRunAt = enabled ? nextBrightDataRunAt(current) : null;
      await db.insert(brightdataSyncSchedules).values({ tenantId, enabled: Number(enabled), timezone: BRIGHTDATA_SCHEDULE_TIME_ZONE, nextRunAt, lastRunAt: null, updatedAt: current }).onDuplicateKeyUpdate({ set: { enabled: Number(enabled), timezone: BRIGHTDATA_SCHEDULE_TIME_ZONE, nextRunAt, updatedAt: current } });
      const [row] = await db.select().from(brightdataSyncSchedules).where(eq(brightdataSyncSchedules.tenantId, tenantId)).limit(1);
      return { enabled: Boolean(row?.enabled), timezone: row?.timezone ?? BRIGHTDATA_SCHEDULE_TIME_ZONE, nextRunAt: row?.nextRunAt?.toISOString() ?? null, lastRunAt: row?.lastRunAt?.toISOString() ?? null };
    } finally { await pool.end(); }
  };
}

export function brightDataRouter(options: BrightDataRouterOptions = {}): Router {
  const router = Router();
  const visibility = options.visibility ?? (async (req: Request) => {
    const session = await requestSession(req);
    return session ? { tenantId: session.tenantId, role: session.role, storeIds: new Set<string>(), skus: new Set<string>() } : undefined;
  });
  const inventory = options.inventory ?? mysqlBrightDataInventorySource();
  const items = options.items ?? mysqlBrightDataItemsSource();
  const search = options.search ?? mysqlBrightDataSearchSource();
  const createItem = options.createItem ?? mysqlBrightDataCreateItem();
  const schedule = options.schedule ?? mysqlBrightDataScheduleSource();
  const setSchedule = options.setSchedule ?? mysqlBrightDataScheduleUpdater();

  router.get('/brightdata/schedule', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      return res.json({ requestId: res.locals.requestId, data: await schedule(scope.tenantId), error: null });
    } catch (error) { return next(error); }
  });

  router.patch('/brightdata/schedule', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'enabled must be a boolean' } });
      return res.json({ requestId: res.locals.requestId, data: await setSchedule(scope.tenantId, req.body.enabled), error: null });
    } catch (error) { return next(error); }
  });

  router.get('/brightdata/search', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!query || query.length > 191) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'q must contain between 1 and 191 characters' } });
      return res.json({ requestId: res.locals.requestId, data: await search(scope.tenantId, query), error: null });
    } catch (error) { return next(error); }
  });

  router.get('/brightdata/inventory', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const filters = readFilters(req);
      if ((!filters.itemId && !filters.itemIds?.length) || (filters.itemIds?.length ?? 0) > 50) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'Search products first and request inventory by matched Item IDs' } });
      const rows = filterInventory(await inventory(scope.tenantId, filters), filters);
      return res.json({ requestId: res.locals.requestId, data: paginate(rows, req), error: null });
    } catch (error) { return next(error); }
  });

  router.get('/brightdata/items', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const filters = readFilters(req);
      const rows = filterItems(await items(scope.tenantId, filters), filters);
      return res.json({ requestId: res.locals.requestId, data: paginate(rows, req), error: null });
    } catch (error) { return next(error); }
  });
  router.post('/brightdata/items', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId.trim() : '';
      const productName = typeof req.body?.productName === 'string' ? req.body.productName.trim() : '';
      const category = typeof req.body?.category === 'string' ? req.body.category.trim() : undefined;
      if (!itemId || !productName || !category) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'Product name, Item ID and category are required' } });
      const row = await createItem(scope.tenantId, { itemId, productName, category });
      return res.status(201).json({ requestId: res.locals.requestId, data: row, error: null });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY') return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: 'Item ID 已存在' } });
      return next(error);
    }
  });
  router.post('/brightdata/items/batch', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const tenantId = scope.tenantId;
      const raw = Array.isArray(req.body?.items) ? req.body.items : [];
      const inputs: BrightDataCreateItemInput[] = raw.map((value: unknown) => ({ itemId: typeof (value as any)?.itemId === 'string' ? (value as any).itemId.trim() : '', productName: typeof (value as any)?.productName === 'string' ? (value as any).productName.trim() : '', category: typeof (value as any)?.category === 'string' ? (value as any).category.trim() : '' })).filter((value: BrightDataCreateItemInput) => value.itemId && value.productName && value.category);
      if (!raw.length || inputs.length !== raw.length) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: '每行都必须填写产品名称、Item ID 和分类' } });
      const normalized = new Set<string>(); const unique = inputs.filter((input) => { const key = input.itemId.toLocaleLowerCase(); if (normalized.has(key)) return false; normalized.add(key); return true; });
      const result = options.createItems ? await options.createItems(tenantId, unique) : await (async () => { const created: BrightDataItemRow[] = []; const skipped: string[] = []; for (const input of unique) { try { created.push(await createItem(tenantId, input)); } catch (error) { if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY') skipped.push(input.itemId); else throw error; } } return { created, skipped }; })();
      return res.status(201).json({ requestId: res.locals.requestId, data: result, error: null });
    } catch (error) { return next(error); }
  });
  return router;
}
