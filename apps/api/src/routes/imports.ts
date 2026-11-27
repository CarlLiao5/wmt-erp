import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { and, asc, createDb, dailyFacts, eq, targetBatches, skuTargetRows, targetImportRows, targetImports, salesTargets } from '@walmart-erp/db';
import { authenticatedSession } from './auth.js';
import { parseTargetWorkbook, targetWorkbook } from './xlsx.js';
import type { OrderLine, OrderVisibility } from './orders.js';
import { canViewStore, filterVisibleSkuRows } from './sku-visibility.js';

export interface TargetImport { id: string; rows: Array<Record<string, unknown>>; status: 'staged' | 'committed'; errors: string[]; }
export interface ImportsRouterOptions {
  visibility?: (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined;
  orders?: (tenantId: string) => Promise<OrderLine[]>;
}
export function validateTargetRows(rows: Array<Record<string, unknown>>): string[] { return rows.flatMap((row, i) => (!row.month || !Number.isFinite(Number(row.target)) ? ['row ' + (i + 1) + ' missing month or target'] : [])); }
function csv(rows: Array<{ month?: unknown; target?: unknown }>) { return ['month,target', ...rows.map((row) => String(row.month ?? '') + ',' + String(row.target ?? ''))].join('\n'); }
function json(res: any, data: unknown, error: unknown = null) { return res.json({ requestId: res.locals.requestId, data, error }); }
function adminOnly(session: { role: string }, res: any): boolean {
  if (session.role === 'admin') return true;
  res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Target management requires admin access' } });
  return false;
}
function pacificMonth(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(date);
}
function storedFactMonth(value: Date | string) {
  // MySQL DATE values are materialized by mysql2 in the host timezone. The
  // aggregate was written as a UTC midnight for the business date; normalize
  // back to that stored calendar date before comparing the month.
  const date = value instanceof Date ? new Date(value.getTime() + 8 * 60 * 60 * 1000) : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return date.toISOString().slice(0, 7);
}

export function importsRouter(options: ImportsRouterOptions = {}): Router {
  const r = Router(); const memory = new Map<string, TargetImport>(); const persistent = Boolean(process.env.MYSQL_URL);
  r.post('/imports/targets', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } });
    if (!adminOnly(session, res)) return;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows as Array<Record<string, unknown>> : []; const errors = validateTargetRows(rows); const id = randomUUID();
    if (!persistent) { const value: TargetImport = { id, rows, status: 'staged', errors }; memory.set(id, value); return res.status(201).json({ requestId: res.locals.requestId, data: value, error: null }); }
    const { db, pool } = createDb(); try { await db.transaction(async (tx) => { const now = new Date(); await tx.insert(targetImports).values({ id, tenantId: session.tenantId, createdBy: session.userId, status: 'staged', errors, createdAt: now, updatedAt: now }); if (rows.length) await tx.insert(targetImportRows).values(rows.map((row, index) => ({ id: randomUUID(), importId: id, lineNo: String(index + 1), month: row.month ? String(row.month) : null, storeId: row.storeId ? String(row.storeId) : null, target: Number.isFinite(Number(row.target)) ? String(row.target) : null, raw: row }))); }); } finally { await pool.end(); }
    return res.status(201).json({ requestId: res.locals.requestId, data: { id, rows, status: 'staged', errors }, error: null });
  } catch (error) { return next(error); } });

  r.post('/imports/targets/xlsx', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } });
    if (!adminOnly(session, res)) return;
    const encoded = typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : '';
    if (!encoded) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: '缺少 Excel 文件内容' } });
    const rows = await parseTargetWorkbook(Buffer.from(encoded, 'base64')); req.body.rows = rows;
    const errors = validateTargetRows(rows); const id = randomUUID();
    if (!persistent) { const value: TargetImport = { id, rows, status: 'staged', errors }; memory.set(id, value); return res.status(201).json({ requestId: res.locals.requestId, data: value, error: null }); }
    const { db, pool } = createDb(); try { await db.transaction(async (tx) => { const now = new Date(); await tx.insert(targetImports).values({ id, tenantId: session.tenantId, createdBy: session.userId, status: 'staged', errors, createdAt: now, updatedAt: now }); if (rows.length) await tx.insert(targetImportRows).values(rows.map((row, index) => ({ id: randomUUID(), importId: id, lineNo: String(index + 1), month: row.month ? String(row.month) : null, storeId: row.storeId ? String(row.storeId) : null, target: Number.isFinite(Number(row.target)) ? String(row.target) : null, raw: row }))); }); } finally { await pool.end(); }
    return res.status(201).json({ requestId: res.locals.requestId, data: { id, rows, status: 'staged', errors }, error: null });
  } catch (error) { return next(error); } });

  r.get('/imports/template', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie);
    if (!session) return res.status(401).send('未登录');
    const content = await targetWorkbook([{}]);
    res.setHeader('Content-Disposition', 'attachment; filename="target-template.xlsx"');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(content);
  } catch (error) { return next(error); } });

  r.get('/targets/summary', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie);
    if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } });
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(now);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : fields.year + '-' + fields.month;
    const storeId = typeof req.query.storeId === 'string' && req.query.storeId.trim() ? req.query.storeId.trim() : undefined;
    const scope = options.visibility ? await options.visibility(req) : undefined;
    if (!scope) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
    if (scope.role !== 'admin') {
      if (storeId && !canViewStore(scope, storeId)) return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } });
      const lines = options.orders ? await options.orders(session.tenantId) : [];
      // “已完成” must use delivered orders only. Including acknowledged,
      // created, or shipped lines makes the target card materially higher
      // than the completed-sales figure shown in the dashboard.
      const scoped = filterVisibleSkuRows(lines.filter((line) => line.tenantId === session.tenantId && line.status !== 'Cancelled' && (!storeId || line.storeId === storeId) && pacificMonth(line.orderedAt) === month), scope);
      const completedSales = scoped.reduce((sum, line) => sum + Number(line.amount || 0), 0);
      return res.json({ requestId: res.locals.requestId, data: { month, storeId: storeId ?? null, target: null, completedSales, completionRate: null, targetAvailable: false, targetUnavailableReason: 'store_target_not_allocatable' }, error: null });
    }
    if (!persistent) return res.json({ requestId: res.locals.requestId, data: { month, storeId: storeId ?? null, target: null, completedSales: 0, completionRate: null }, error: null });
    const { db, pool } = createDb();
    try {
      const finalized = await db.select({ id: targetBatches.id }).from(targetBatches).where(and(eq(targetBatches.tenantId, session.tenantId), eq(targetBatches.month, month), eq(targetBatches.status, 'finalized'))).orderBy(asc(targetBatches.revision)).limit(1);
      const finalizedRows = finalized[0] ? await db.select({ amountTarget: skuTargetRows.amountTarget, storeId: skuTargetRows.storeId }).from(skuTargetRows).where(eq(skuTargetRows.batchId, finalized[0].id)) : [];
      const targetRows = finalizedRows.length ? finalizedRows.map((row) => ({ target: row.amountTarget, storeId: row.storeId })) : await db.select({ target: salesTargets.target, storeId: salesTargets.storeId }).from(salesTargets).where(and(eq(salesTargets.tenantId, session.tenantId), eq(salesTargets.month, month)));
      const scopedTargets = storeId ? targetRows.filter((row) => row.storeId === storeId) : targetRows;
      // Use the same order-line source and non-cancelled status rule as the
      // performance endpoint. daily_facts can lag or contain an older
      // aggregation, which made Dashboard and Targets disagree.
      const lines = options.orders ? await options.orders(session.tenantId) : [];
      const completedSales = lines.filter((line) => line.tenantId === session.tenantId && line.status !== 'Cancelled' && (!storeId || line.storeId === storeId) && pacificMonth(line.orderedAt) === month).reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const targetValues = scopedTargets.map((row) => Number(row.target)).filter(Number.isFinite);
      const target = targetValues.length ? targetValues.reduce((sum, value) => sum + value, 0) : null;
      return res.json({ requestId: res.locals.requestId, data: { month, storeId: storeId ?? null, target, completedSales, completionRate: target && target > 0 ? completedSales / target : null }, error: null });
    } finally { await pool.end(); }
  } catch (error) { return next(error); } });

  r.get('/imports/:id', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } });
    if (!adminOnly(session, res)) return;
    if (!persistent) { const value = memory.get(req.params.id); if (!value) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Import not found' } }); return json(res, value); }
    const { db, pool } = createDb(); try { const [batch] = await db.select().from(targetImports).where(and(eq(targetImports.id, req.params.id), eq(targetImports.tenantId, session.tenantId))).limit(1); if (!batch) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Import not found' } }); const rows = await db.select().from(targetImportRows).where(eq(targetImportRows.importId, batch.id)).orderBy(asc(targetImportRows.lineNo)); return json(res, { id: batch.id, rows: rows.map((row) => ({ month: row.month, target: row.target == null ? null : Number(row.target) })), status: batch.status, errors: Array.isArray(batch.errors) ? batch.errors : [] }); } finally { await pool.end(); }
  } catch (error) { return next(error); } });

  r.get('/imports/:id/export', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie); if (!session) return res.status(401).send('未登录');
    if (!adminOnly(session, res)) return;
    if (!persistent) { const value = memory.get(req.params.id); if (!value) return res.status(404).send('Import not found'); if (req.query.format === 'xlsx') { res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); return res.send(await targetWorkbook(value.rows)); } return res.type('text/csv').send(csv(value.rows)); }
    const { db, pool } = createDb(); try { const [batch] = await db.select({ id: targetImports.id }).from(targetImports).where(and(eq(targetImports.id, req.params.id), eq(targetImports.tenantId, session.tenantId))).limit(1); if (!batch) return res.status(404).send('Import not found'); const rows = await db.select({ month: targetImportRows.month, target: targetImportRows.target }).from(targetImportRows).where(eq(targetImportRows.importId, batch.id)).orderBy(asc(targetImportRows.lineNo)); if (req.query.format === 'xlsx') { res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); return res.send(await targetWorkbook(rows)); } return res.type('text/csv').send(csv(rows)); } finally { await pool.end(); }
  } catch (error) { return next(error); } });

  r.post('/imports/:id/commit', async (req, res, next) => { try {
    const session = await authenticatedSession(req.headers.cookie); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } });
    if (!adminOnly(session, res)) return;
    if (!persistent) { const value = memory.get(req.params.id); if (!value) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Import not found' } }); if (value.errors.length) return res.status(422).json({ requestId: res.locals.requestId, data: value, error: { message: 'Import validation failed' } }); value.status = 'committed'; return json(res, value); }
    const { db, pool } = createDb(); try { const result = await db.transaction(async (tx) => { const [batch] = await tx.select().from(targetImports).where(and(eq(targetImports.id, req.params.id), eq(targetImports.tenantId, session.tenantId))).limit(1); if (!batch) return { status: 404, body: { requestId: res.locals.requestId, data: null, error: { message: 'Import not found' } } }; const errors = Array.isArray(batch.errors) ? batch.errors as string[] : []; if (errors.length) return { status: 422, body: { requestId: res.locals.requestId, data: batch, error: { message: 'Import validation failed' } } }; const rows = await tx.select().from(targetImportRows).where(eq(targetImportRows.importId, batch.id)).orderBy(asc(targetImportRows.lineNo)); const now = new Date(); for (const row of rows) await tx.insert(salesTargets).values({ id: randomUUID(), tenantId: session.tenantId, importId: batch.id, month: String(row.month), storeId: row.storeId ?? null, target: String(row.target), createdAt: now }).onDuplicateKeyUpdate({ set: { importId: batch.id, target: String(row.target), createdAt: now } }); await tx.update(targetImports).set({ status: 'committed', updatedAt: now }).where(eq(targetImports.id, batch.id)); return { status: 200, body: { requestId: res.locals.requestId, data: { id: batch.id, status: 'committed', rows: rows.map((row) => ({ month: row.month, storeId: row.storeId, target: Number(row.target) })), errors: [] }, error: null } }; }); return res.status(result.status).json(result.body); } finally { await pool.end(); }
  } catch (error) { return next(error); } });
  return r;
}
