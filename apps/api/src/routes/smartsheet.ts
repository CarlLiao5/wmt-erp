import { Router, type Request } from 'express';
import { createDb, eq, smartSheetAllSkuRows } from '@walmart-erp/db';
import { requestSession } from './auth.js';

export interface AllSkuRow { sourceRowId: string; sku?: string | null; itemId?: string | null; productName?: string | null; storeName?: string | null; ownerName?: string | null; payload?: unknown; syncedAt: Date; updatedAt: Date }
export interface AllSkuSource { list: (tenantId: string) => Promise<AllSkuRow[]> }

export function mysqlAllSkuSource(): AllSkuSource {
  return { async list(tenantId) {
    const { db, pool } = createDb();
    try {
      const rows = await db.select({ sourceRowId: smartSheetAllSkuRows.sourceRowId, sku: smartSheetAllSkuRows.sku, itemId: smartSheetAllSkuRows.itemId, productName: smartSheetAllSkuRows.productName, storeName: smartSheetAllSkuRows.storeName, ownerName: smartSheetAllSkuRows.ownerName, syncedAt: smartSheetAllSkuRows.syncedAt, updatedAt: smartSheetAllSkuRows.updatedAt })
        .from(smartSheetAllSkuRows).where(eq(smartSheetAllSkuRows.tenantId, tenantId));
      return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(row => ({ ...row, payload: { values: { SKU: row.sku ? [{ text: row.sku }] : [], 'Item ID': row.itemId ? [{ text: row.itemId }] : [], 品名: row.productName ? [{ text: row.productName }] : [], 店铺: row.storeName ? [{ text: row.storeName }] : [], 当前负责人: row.ownerName ? [{ text: row.ownerName }] : [] } } }));
    } finally { await pool.end(); }
  } };
}

export function allSkuRouter(source: AllSkuSource): Router {
  const router = Router();
  router.get('/smartsheet/allsku2026', async (req: Request, res, next) => {
    try {
      const session = await requestSession(req);
      if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
      const query = typeof req.query.search === 'string' ? req.query.search.trim().toLocaleLowerCase() : '';
      const rows = await source.list(session.tenantId);
      const filtered = query ? rows.filter((row) => [row.sourceRowId, row.sku, row.itemId, row.productName, row.storeName, row.ownerName].some((value) => String(value ?? '').toLocaleLowerCase().includes(query))) : rows;
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const currentPage = Math.min(page, totalPages);
      return res.json({ requestId: res.locals.requestId, data: { rows: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), pagination: { page: currentPage, pageSize, total: filtered.length, totalPages } }, error: null });
    } catch (error) { return next(error); }
  });
  return router;
}
