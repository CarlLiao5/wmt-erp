import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { and, createDb, desc, eq, gte, inArray, lte, orderLines, orders, salesTargets, smartSheetAllSkuRows, skuTargetRows, targetBatches, stores, skus } from '@walmart-erp/db';
import { authenticatedSession } from './auth.js';
import { calculateMonthlySkuTarget, importedTargetNumber, MONTHLY_TARGET_FORMULA_VERSION, optionalTargetNumber, planMonthlyTargetInitialization, resolveImportedMonthlyTargets } from './monthlyTargets.js';
import type { OrderLine, OrderVisibility } from './orders.js';
import { canViewStore, filterVisibleSkuRows } from './sku-visibility.js';
import { parseMonthlyTargetWorkbook, targetMonthlyWorkbook } from './xlsx.js';
import type { ProductImageKey } from './product-images.js';
import { allSkuProductFields } from './allskuOwnerMapping.js';
import { isCancelledOrderStatus } from '../../../../packages/domain/src/orderStatus.js';

export interface MonthlyTargetInventory { storeId: string; sku: string; quantity: number; }
export interface MonthlyTargetsRouterOptions {
  visibility: (req: Request) => Promise<OrderVisibility | undefined>;
  orders: (tenantId: string, query?: { from?: string; to?: string }) => Promise<OrderLine[]>;
  inventory: (tenantId: string) => Promise<MonthlyTargetInventory[]>;
  productImages?: (tenantId: string, products: ProductImageKey[]) => Promise<Map<string, string>>;
}
function json(res: any, data: unknown, error: unknown = null) { return res.json({ requestId: res.locals.requestId, data, error }); }
function monthParts(month: string) { const m = /^(\d{4})-(\d{2})$/.exec(month); if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('month must use YYYY-MM format'); return { year: Number(m[1]), month: Number(m[2]) }; }
function priorMonth(month: string) { const { year, month: m } = monthParts(month); const date = new Date(Date.UTC(year, m - 1, 1)); date.setUTCMonth(date.getUTCMonth() - 1); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
function monthRange(month: string) { const { year, month: m } = monthParts(month); const start = new Date(Date.UTC(year, m - 1, 1)); const end = new Date(Date.UTC(year, m, 1)); return { from: new Date(start.getTime() - 86400000).toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }; }
function pacificMonth(value?: string | Date) { if (!value) return ''; const d = new Date(value); if (!Number.isFinite(d.getTime())) return ''; return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(d); }

export function monthlyTargetsRouter(options: MonthlyTargetsRouterOptions): Router {
  const r = Router();
  const requireAdmin = async (req: Request, res: any) => { const session = await authenticatedSession(req.headers.cookie); if (!session) { res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } }); return undefined; } if (session.role !== 'admin') { res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Target management requires admin access' } }); return undefined; } return session; };
  r.post('/targets/initialize', async (req, res, next) => { try {
    const session = await requireAdmin(req, res); if (!session) return; const month = String(req.body?.month ?? ''); monthParts(month); const { db, pool } = createDb();
    try {
      const existing = await db.select().from(targetBatches).where(and(eq(targetBatches.tenantId, session.tenantId), eq(targetBatches.month, month))).orderBy(desc(targetBatches.revision)).limit(1);
      const existingBatch = existing[0];
      const [existingRow] = existingBatch ? await db.select({ id: skuTargetRows.id }).from(skuTargetRows).where(eq(skuTargetRows.batchId, existingBatch.id)).limit(1) : [];
      const plan = planMonthlyTargetInitialization(existingBatch, existingRow ? 1 : 0);
      if (plan.action === 'reuse') return json(res, { batch: existingBatch, reused: true });
      const prior = priorMonth(month); const range = monthRange(prior); const [sourceRows, tenantStores, inventory, orderRows] = await Promise.all([
        db.select({ sourceRowId: smartSheetAllSkuRows.sourceRowId, sku: smartSheetAllSkuRows.sku, storeName: smartSheetAllSkuRows.storeName, productName: smartSheetAllSkuRows.productName, ownerName: smartSheetAllSkuRows.ownerName, itemId: smartSheetAllSkuRows.itemId, updatedAt: smartSheetAllSkuRows.updatedAt }).from(smartSheetAllSkuRows).where(eq(smartSheetAllSkuRows.tenantId, session.tenantId)),
        db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.tenantId, session.tenantId)),
        options.inventory(session.tenantId), options.orders(session.tenantId, range),
      ]);
      const storeByName = new Map(tenantStores.map((s) => [s.name.trim(), s.id])); const latest = new Map<string, typeof sourceRows[number]>(); for (const row of sourceRows) { const prev = latest.get(row.sourceRowId); if (!prev || row.updatedAt > prev.updatedAt) latest.set(row.sourceRowId, row); }
      const catalog = await db.select({ storeId: skus.storeId, sku: skus.externalId, itemId: skus.itemId, title: skus.title }).from(skus).where(eq(skus.tenantId, session.tenantId)); const catalogMap = new Map(catalog.map((row) => [`${row.storeId}:${row.sku.trim().toUpperCase()}`, row]));
      const inv = new Map(inventory.map((row) => [`${row.storeId}:${row.sku.trim().toUpperCase()}`, Number(row.quantity)])); const sales = new Map<string, { units: number; revenue: number }>(); for (const line of filterVisibleSkuRows(orderRows, { role: 'admin', storeIds: new Set(), skus: new Set() })) { if (pacificMonth(line.orderedAt) !== prior || isCancelledOrderStatus(line.status)) continue; const key = `${line.storeId}:${line.sku.trim().toUpperCase()}`; const v = sales.get(key) ?? { units: 0, revenue: 0 }; v.units += Number(line.quantity || 0); v.revenue += Number(line.amount || 0); sales.set(key, v); }
      const batchId = plan.action === 'repair' ? plan.batchId : randomUUID(); const now = new Date(); const details = [...latest.values()].flatMap((source) => { const parsed = allSkuProductFields(source); const storeId = storeByName.get(parsed.storeName); if (!storeId || !parsed.sku) return []; const catalogRow = catalogMap.get(`${storeId}:${parsed.sku.trim().toUpperCase()}`); if (!catalogRow) return []; const key = `${storeId}:${parsed.sku.trim().toUpperCase()}`; const sale = sales.get(key) ?? { units: null as number | null, revenue: null as number | null }; const calc = calculateMonthlySkuTarget({ month, priorMonthUnits: sale.units, priorMonthRevenue: sale.revenue, priorMonthDays: new Date(Date.UTC(Number(prior.slice(0, 4)), Number(prior.slice(5, 7)), 0)).getUTCDate(), inventoryQuantity: inv.get(key) }); return [{ id: randomUUID(), batchId, tenantId: session.tenantId, month, storeId, sku: catalogRow.sku, itemId: parsed.itemId || catalogRow.itemId, productName: parsed.productName || catalogRow.title, ownerName: parsed.ownerName || null, inventoryQuantity: inv.get(key)?.toString() ?? null, lastMonthUnits: calc.lastMonthAvgDailySales == null ? null : String(sale.units), lastMonthDays: calc.priorMonthDays, lastMonthAvgDailySales: calc.lastMonthAvgDailySales?.toString() ?? null, lastMonthAvgPrice: calc.lastMonthAvgPrice?.toString() ?? null, expectedDailySales: calc.expectedDailySales?.toString() ?? null, sellingDays: calc.sellingDays?.toString() ?? null, quantityTarget: calc.quantityTarget?.toString() ?? null, amountTarget: calc.amountTarget?.toString() ?? null, missingReasons: calc.missingReasons, status: 'draft', createdAt: now, updatedAt: now }]; });
      await db.transaction(async (tx) => { if (plan.action === 'repair') await tx.update(targetBatches).set({ sourceSnapshotAt: now, updatedAt: now }).where(eq(targetBatches.id, batchId)); else await tx.insert(targetBatches).values({ id: batchId, tenantId: session.tenantId, month, revision: plan.revision, status: 'draft', formulaVersion: MONTHLY_TARGET_FORMULA_VERSION, sourceSnapshotAt: now, createdBy: session.userId, createdAt: now, updatedAt: now }); if (details.length) await tx.insert(skuTargetRows).values(details); });
      return res.status(201).json({ requestId: res.locals.requestId, data: { batch: { id: batchId, tenantId: session.tenantId, month, revision: plan.revision, status: 'draft', formulaVersion: MONTHLY_TARGET_FORMULA_VERSION }, rows: details, reused: false }, error: null });
    } finally { await pool.end(); }
  } catch (e) { return next(e); } });

  r.post('/targets/:batchId/revision', async (req, res, next) => { try {
    const session = await requireAdmin(req, res); if (!session) return;
    const { db, pool } = createDb();
    try {
      const [sourceBatch] = await db.select().from(targetBatches).where(and(eq(targetBatches.id, req.params.batchId), eq(targetBatches.tenantId, session.tenantId))).limit(1);
      if (!sourceBatch) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: '目标批次不存在' } });
      if (sourceBatch.status !== 'finalized') return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: '只有已定版批次可以创建修订草稿' } });
      const [latestBatch] = await db.select().from(targetBatches).where(and(eq(targetBatches.tenantId, session.tenantId), eq(targetBatches.month, sourceBatch.month))).orderBy(desc(targetBatches.revision)).limit(1);
      if (latestBatch?.id !== sourceBatch.id) return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: latestBatch?.status === 'draft' ? '该月份已有草稿，请继续调整现有草稿' : '请从最新定版批次创建修订' } });
      const sourceRows = await db.select().from(skuTargetRows).where(eq(skuTargetRows.batchId, sourceBatch.id));
      const now = new Date();
      const batchId = randomUUID();
      const revision = sourceBatch.revision + 1;
      const rows = sourceRows.map((row) => ({ ...row, id: randomUUID(), batchId, status: 'draft', createdAt: now, updatedAt: now }));
      await db.transaction(async (tx) => {
        await tx.insert(targetBatches).values({ id: batchId, tenantId: session.tenantId, month: sourceBatch.month, revision, status: 'draft', formulaVersion: sourceBatch.formulaVersion, sourceSnapshotAt: sourceBatch.sourceSnapshotAt, createdBy: session.userId, createdAt: now, updatedAt: now });
        if (rows.length) await tx.insert(skuTargetRows).values(rows);
      });
      return res.status(201).json({ requestId: res.locals.requestId, data: { batch: { id: batchId, tenantId: session.tenantId, month: sourceBatch.month, revision, status: 'draft', formulaVersion: sourceBatch.formulaVersion }, rows }, error: null });
    } finally { await pool.end(); }
  } catch (e) { return next(e); } });

  r.get('/targets/performance', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie);
    if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } });
    const month = typeof req.query.month === 'string' ? req.query.month : '';
    try { monthParts(month); } catch { return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'month must use YYYY-MM format' } }); }
    const storeId = typeof req.query.storeId === 'string' && req.query.storeId.trim() ? req.query.storeId.trim() : undefined;
    const scope = await options.visibility(req);
    if (!scope) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    if (storeId && scope.role !== 'admin' && !canViewStore(scope, storeId)) {
      return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } });
    }
    const { db, pool } = createDb();
    try {
      const [batch] = await db.select().from(targetBatches).where(and(eq(targetBatches.tenantId, session.tenantId), eq(targetBatches.month, month), eq(targetBatches.status, 'finalized'))).orderBy(desc(targetBatches.revision)).limit(1);
      if (!batch) return json(res, { month, batch: null, rows: [] });
      const storedRows = await db.select().from(skuTargetRows).where(eq(skuTargetRows.batchId, batch.id));
      const visibleRows = session.role === 'admin' ? storedRows : filterVisibleSkuRows(storedRows, scope);
      const selectedRows = storeId ? visibleRows.filter((row) => row.storeId === storeId) : visibleRows;
      const images = options.productImages ? await options.productImages(session.tenantId, selectedRows.map((row) => ({ storeId: row.storeId, sku: row.sku }))) : new Map<string, string>();
      // Use the normalized order_lines source shared with Dashboard. The raw
      // order projection can contain sales amounts without a usable quantity;
      // order_lines is the persisted source of truth for SKU units.
      const catalog = await db.select({ id: skus.id, storeId: skus.storeId, sku: skus.externalId }).from(skus).where(eq(skus.tenantId, session.tenantId));
      const skuById = new Map(catalog.map((sku) => [sku.id, sku]));
      const skuByStoreAndValue = new Map(catalog.map((sku) => [`${sku.storeId}:${sku.sku.trim().toUpperCase()}`, sku]));
      // Restrict the joined order scan to the selected month before applying
      // the Pacific-month check below. The previous implementation loaded all
      // historical order lines for the tenant, which made a finalized month
      // appear to hang on larger tenants.
      const monthBounds = monthParts(month);
      const monthStartUtc = new Date(Date.UTC(monthBounds.year, monthBounds.month - 1, 1) - 2 * 86400000);
      const monthEndUtc = new Date(Date.UTC(monthBounds.year, monthBounds.month, 1) + 2 * 86400000);
      const lineRows = await db.select({ storeId: orderLines.storeId, skuId: orderLines.skuId, quantity: orderLines.quantity, lineAmount: orderLines.lineAmount, orderedAt: orders.orderedAt, status: orders.status })
        .from(orderLines).innerJoin(orders, eq(orderLines.orderId, orders.id))
        .where(and(eq(orderLines.tenantId, session.tenantId), eq(orders.tenantId, session.tenantId), gte(orders.orderedAt, monthStartUtc), lte(orders.orderedAt, monthEndUtc), ...(storeId ? [eq(orderLines.storeId, storeId)] : [])));
      const visibleOrders = filterVisibleSkuRows(lineRows.flatMap((line) => {
        const catalogRow = skuById.get(line.skuId) ?? skuByStoreAndValue.get(`${line.storeId}:${line.skuId.split(':').at(-1)?.trim().toUpperCase()}`);
        if (!catalogRow || !line.orderedAt || pacificMonth(line.orderedAt) !== month) return [];
        if (isCancelledOrderStatus(line.status)) return [];
        return [{ tenantId: session.tenantId, orderId: '', storeId: line.storeId, sku: catalogRow.sku, quantity: Number(line.quantity), amount: Number(line.lineAmount), orderedAt: line.orderedAt.toISOString(), status: line.status }];
      }), scope);
      const salesBySku = new Map<string, { amount: number; units: number }>();
      for (const line of visibleOrders) {
        const key = `${line.storeId}:${line.sku.trim().toUpperCase()}`;
        const sales = salesBySku.get(key) ?? { amount: 0, units: 0 };
        sales.amount += Number(line.amount || 0);
        sales.units += Number(line.quantity || 0);
        salesBySku.set(key, sales);
      }
      const rows = selectedRows.map((row) => {
        const sales = salesBySku.get(`${row.storeId}:${row.sku.trim().toUpperCase()}`) ?? { amount: 0, units: 0 };
        return { ...row, imageUrl: images.get(`${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`), completedSales: sales.amount, completedUnits: sales.units, actualUnits: sales.units };
      });
      return json(res, { month, batch: { id: batch.id, status: batch.status, revision: batch.revision }, rows });
    } finally { await pool.end(); }
  } catch (e) { return next(e); } });
  r.get('/targets/:batchId', async (req, res, next) => { try { const session = await authenticatedSession(req.headers.cookie); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } }); const { db, pool } = createDb(); try { const [batch] = await db.select().from(targetBatches).where(and(eq(targetBatches.id, req.params.batchId), eq(targetBatches.tenantId, session.tenantId))).limit(1); if (!batch) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Target batch not found' } }); const rows = await db.select().from(skuTargetRows).where(eq(skuTargetRows.batchId, batch.id)); const visible = session.role === 'admin' ? rows : filterVisibleSkuRows(rows, await options.visibility(req)); const images = options.productImages ? await options.productImages(session.tenantId, visible.map((row) => ({ storeId: row.storeId, sku: row.sku }))) : new Map<string, string>(); return json(res, { batch, rows: visible.map((row) => ({ ...row, imageUrl: images.get(`${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`) })) }); } finally { await pool.end(); } } catch (e) { return next(e); } });
  r.get('/targets/:batchId/export', async (req, res, next) => { try { const session = await requireAdmin(req, res); if (!session) return; const { db, pool } = createDb(); try { const [batch] = await db.select().from(targetBatches).where(and(eq(targetBatches.id, req.params.batchId), eq(targetBatches.tenantId, session.tenantId))).limit(1); if (!batch) return res.status(404).send('Target batch not found'); const rows = await db.select().from(skuTargetRows).where(eq(skuTargetRows.batchId, batch.id)); if (req.query.format !== 'xlsx') return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'Only xlsx export is supported' } }); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="monthly-targets-${batch.month}.xlsx"`); return res.send(await targetMonthlyWorkbook(rows)); } finally { await pool.end(); } } catch (e) { return next(e); } });
  r.use('/targets/:batchId/preview', async (req, res, next) => { if (typeof req.body?.contentBase64 !== 'string' || !req.body.contentBase64) return next(); try { const encoded = req.body.contentBase64; const buffer = Buffer.from(encoded, 'base64'); if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'Excel 文件编码无效，请重新导出后上传' } }); req.body.rows = await parseMonthlyTargetWorkbook(buffer); return next(); } catch { return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'Excel 文件解析失败，请确认使用“导出带公式 Excel”模板' } }); } });
  r.post('/targets/:batchId/preview', async (req, res, next) => { try { const session = await requireAdmin(req, res); if (!session) return; const { db, pool } = createDb(); try {
    const [batch] = await db.select().from(targetBatches).where(and(eq(targetBatches.id, req.params.batchId), eq(targetBatches.tenantId, session.tenantId))).limit(1);
    if (!batch) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: '目标批次不存在，请刷新月份后重试' } });
    if (batch.status === 'finalized') return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: '该批次已定版，请创建新版本后再调整' } });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return json(res, { batch, rows: [], errors: ['Excel 中没有可导入的数据行'] });
    const errors: string[] = [];
    const original = await db.select().from(skuTargetRows).where(eq(skuTargetRows.batchId, batch.id));
    const storesInTenant = await db.select({ id: stores.id }).from(stores).where(eq(stores.tenantId, session.tenantId));
    const storeIds = storesInTenant.map((store) => store.id);
    const catalogRows = storeIds.length ? await db.select({ storeId: skus.storeId, sku: skus.externalId, itemId: skus.itemId, title: skus.title }).from(skus).where(and(eq(skus.tenantId, session.tenantId), inArray(skus.storeId, storeIds))) : [];
    const catalogByKey = new Map(catalogRows.map((row) => [`${row.storeId}:${row.sku.trim().toUpperCase()}`, row]));
    const originalByKey = new Map(original.map((row) => [`${row.storeId}:${row.sku.trim().toUpperCase()}`, row]));
    const seen = new Set<string>();
    const monthDays = new Date(Date.UTC(Number(batch.month.slice(0, 4)), Number(batch.month.slice(5, 7)), 0)).getUTCDate();
    const prepared: Array<typeof skuTargetRows.$inferInsert> = rows.map((row: any, i: number) => {
      const rowNumber = i + 2;
      const storeId = String(row.storeId ?? '').trim();
      const sku = String(row.sku ?? '').trim();
      const key = `${storeId}:${sku.toUpperCase()}`;
      if (row.month && String(row.month).slice(0, 7) !== batch.month) errors.push(`第 ${rowNumber} 行：目标月份与当前批次 ${batch.month} 不一致`);
      if (!storeId || !sku) errors.push(`第 ${rowNumber} 行：店铺和 SKU 不能为空`);
      if (seen.has(key)) errors.push(`第 ${rowNumber} 行：店铺和 SKU 重复`);
      seen.add(key);
      const source = originalByKey.get(key);
      const catalog = catalogByKey.get(key);
      if (!catalog) errors.push(`第 ${rowNumber} 行：店铺 ${storeId} 下找不到 SKU ${sku}`);
      const expected = optionalTargetNumber(row.expectedDailySales);
      if (expected == null || !Number.isFinite(expected) || expected < 0) errors.push(`第 ${rowNumber} 行：预计日销必须是大于等于 0 的数字`);
      const sellingDays = optionalTargetNumber(row.sellingDays);
      if (sellingDays != null && (!Number.isFinite(sellingDays) || sellingDays < 0 || sellingDays > monthDays)) errors.push(`第 ${rowNumber} 行：销售天数必须在 0 到 ${monthDays} 之间`);
      const sourceUnits = importedTargetNumber(row.lastMonthUnits, source?.lastMonthUnits);
      const sourcePrice = importedTargetNumber(row.lastMonthAvgPrice, source?.lastMonthAvgPrice);
      const sourceInventory = importedTargetNumber(row.inventoryQuantity, source?.inventoryQuantity);
      const priorDaysValue = importedTargetNumber(row.lastMonthDays, source?.lastMonthDays);
      const priorDays = priorDaysValue ?? 0;
      const calc = calculateMonthlySkuTarget({ month: batch.month, priorMonthUnits: sourceUnits, priorMonthRevenue: sourcePrice == null || sourceUnits == null ? null : sourcePrice * sourceUnits, priorMonthDays: priorDays, inventoryQuantity: sourceInventory, expectedDailySales: expected, sellingDays });
      const targets = resolveImportedMonthlyTargets(row, calc);
      return { id: source?.id ?? randomUUID(), batchId: batch.id, tenantId: session.tenantId, month: batch.month, storeId, sku: catalog?.sku ?? sku, itemId: catalog?.itemId || row.itemId || null, productName: catalog?.title || row.productName || null, ownerName: source?.ownerName || row.ownerName || null, inventoryQuantity: sourceInventory?.toString() ?? null, lastMonthUnits: sourceUnits?.toString() ?? null, lastMonthDays: priorDaysValue, lastMonthAvgDailySales: importedTargetNumber(row.lastMonthAvgDailySales, source?.lastMonthAvgDailySales)?.toString() ?? null, lastMonthAvgPrice: sourcePrice?.toString() ?? null, expectedDailySales: expected?.toString() ?? null, sellingDays: calc.sellingDays?.toString() ?? null, quantityTarget: targets.quantityTarget?.toString() ?? null, amountTarget: targets.amountTarget?.toString() ?? null, missingReasons: calc.missingReasons, status: 'draft', createdAt: source?.createdAt ?? new Date(), updatedAt: new Date() };
    });
    if (errors.length) return json(res, { batch, rows: prepared, errors });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.delete(skuTargetRows).where(eq(skuTargetRows.batchId, batch.id));
      await tx.insert(skuTargetRows).values(prepared.map((row) => ({ ...row, createdAt: row.createdAt ?? now, updatedAt: now })));
      await tx.update(targetBatches).set({ updatedAt: now }).where(eq(targetBatches.id, batch.id));
    });
    return json(res, { batch: { ...batch, updatedAt: now }, rows: prepared, errors: [] });
  } finally { await pool.end(); } } catch (e) { return next(e); } });
  r.post('/targets/:batchId/finalize', async (req, res, next) => { try { const session = await requireAdmin(req, res); if (!session) return; const { db, pool } = createDb(); try { const [batch] = await db.select().from(targetBatches).where(and(eq(targetBatches.id, req.params.batchId), eq(targetBatches.tenantId, session.tenantId))).limit(1); if (!batch) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Target batch not found' } }); if (batch.status === 'finalized') return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: 'Batch already finalized' } }); const rows = await db.select().from(skuTargetRows).where(eq(skuTargetRows.batchId, batch.id)); const totals = new Map<string, number>(); for (const row of rows) if (row.amountTarget != null && Number.isFinite(Number(row.amountTarget))) totals.set(row.storeId, (totals.get(row.storeId) ?? 0) + Number(row.amountTarget)); const now = new Date(); await db.transaction(async (tx) => { await tx.update(targetBatches).set({ status: 'finalized', updatedAt: now }).where(eq(targetBatches.id, batch.id)); for (const [storeId, target] of totals) await tx.insert(salesTargets).values({ id: randomUUID(), tenantId: session.tenantId, importId: batch.id, month: batch.month, storeId, target: target.toFixed(4), createdAt: now }).onDuplicateKeyUpdate({ set: { importId: batch.id, target: target.toFixed(4), createdAt: now } }); }); return json(res, { id: batch.id, status: 'finalized', storeTotals: [...totals].map(([storeId, target]) => ({ storeId, target })) }); } finally { await pool.end(); } } catch (e) { return next(e); } });
  return r;
}
