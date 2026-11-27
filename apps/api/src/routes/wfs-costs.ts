import { invalidateMonthlyProfit } from './profit.js';
import { wfsPaymentAverages } from './wfs-last-mile.js';
import { Router, raw } from 'express';
import ExcelJS from 'exceljs';
import { createDb } from '@walmart-erp/db';
import { requestSession } from './auth.js';

const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const columns = ['SKU', 'UPC', 'Item ID', '品名', '出库采购单价', '出库头程单价'];
const feeColumns = ['手填尾程（USD/件）', '手填佣金率（%）'];
class InvalidCost extends Error {}

function field(value: unknown, max: number, required = false) {
  const result = String(value ?? '').trim();
  if (result.length > max || (required && !result)) throw new InvalidCost('请检查字段长度和必填项');
  return result;
}

function amount(value: unknown) {
  const result = String(value ?? '').trim();
  if (!/^\d{1,12}(?:\.\d+)?$/.test(result)) throw new InvalidCost('采购和头程单价必须是非负数字');
  return result;
}

function cost(input: Record<string, unknown>, partial = false) {
  return {
    sku: field(input.sku, 191, true).toUpperCase(),
    upc: field(input.upc, 32), itemId: field(input.itemId, 32),
    productName: field(input.productName, 255),
    purchaseCost: partial && !String(input.purchaseCost ?? '').trim() ? null : amount(input.purchaseCost), freightCost: String(input.freightCost ?? '').trim() ? amount(input.freightCost) : null,
  };
}

type Cost = ReturnType<typeof cost> & {
  manualLastMile?: string | null;
  manualCommissionPercent?: string | null;
};

export async function parseWfsCosts(buffer: Buffer, period: string): Promise<Cost[]> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw new InvalidCost('无法读取 Excel 文件'); }
  const sheet = workbook.getWorksheet(period);
  if (!sheet) throw new InvalidCost('未找到工作表「' + period + '」');
  const header = sheet.getRow(1);
  const indices = [...columns, ...feeColumns].map((column) => (header.values as ExcelJS.CellValue[]).findIndex((value) => (String(value ?? '').trim().toUpperCase() === column.toUpperCase() || (column === 'SKU' && String(value ?? '').trim().toUpperCase() === 'MSKU'))));
  if (indices.slice(0, columns.length).some((index) => index < 1)) throw new InvalidCost('缺少表头：' + columns.join('、'));
  const seen = new Set<string>();
  const rows: Cost[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = indices.map((column, position) => {
      if (column < 1) return '';
      const cell = row.getCell(column);
      const value = cell.value;
      const raw = value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)
        ? cell.result : value;
      if (position === 7) {
        if (typeof raw === 'number' && /%/.test(cell.numFmt ?? '')) return (raw * 100).toFixed(6);
        return String(raw ?? '').trim().replace(/[%％]$/, '').trim();
      }
      return raw !== value ? String(raw ?? '').trim() : cell.text.trim();
    });
    if (values.every((value) => !value)) return;
    try {
      const [sku, upc, itemId, productName, purchaseCost, freightCost, lastMile, commission] = values;
      const entry: Cost = cost({ sku, upc, itemId, productName, purchaseCost, freightCost }, true);
      if (lastMile) entry.manualLastMile = optionalFee(lastMile);
      if (commission) entry.manualCommissionPercent = optionalFee(commission, true);
      if (seen.has(entry.sku)) throw new InvalidCost('SKU 重复：' + entry.sku);
      seen.add(entry.sku);
      rows.push(entry);
    } catch (error) {
      if (error instanceof InvalidCost) throw new InvalidCost('第 ' + index + ' 行：' + error.message);
      throw error;
    }
  });
  if (!rows.length || rows.length > 5000) throw new InvalidCost('每次导入须包含 1–5000 行');
  return rows;
}

// Import blanks are patches, not requests to clear previously saved values.
export function mergeCostImport(rows: Cost[], existing: Cost[]): Cost[] {
  const bySku = new Map(existing.map(row => [row.sku.trim().toUpperCase(), row]));
  return rows.map(row => {
    const sku = row.sku.trim().toUpperCase();
    const previous = bySku.get(sku);
    const merged = { ...row, sku };
    for (const key of ['upc', 'itemId', 'productName'] as const) {
      if (!merged[key].trim()) merged[key] = previous?.[key] ?? '';
    }
    merged.purchaseCost ??= previous?.purchaseCost ?? null;
    merged.freightCost ??= previous?.freightCost ?? null;
    if (merged.purchaseCost == null) throw new InvalidCost('新 SKU「' + sku + '」须填写出库采购单价');
    return merged;
  });
}

async function existingCosts(tenantId: string, rows: Cost[], connection: Pick<ReturnType<typeof createDb>['pool'], 'query'> = createDb().pool, lock = false): Promise<Cost[]> {
  const skus = [...new Set(rows.map(row => row.sku.trim().toUpperCase()))].sort();
  if (!skus.length) return [];
  const [existing] = await connection.query(
    `SELECT sku, upc, item_id AS itemId, product_name AS productName, purchase_cost AS purchaseCost, freight_cost AS freightCost
       FROM wfs_costs WHERE tenant_id=? AND sku IN (?) ORDER BY sku${lock ? ' FOR UPDATE' : ''}`,
    [tenantId, skus],
  );
  return existing as Cost[];
}

type Metadata = {sku: string; upc: string; itemId: string; productName: string};
export function fillCostMetadata<T extends Metadata>(rows: T[], catalog: Metadata[]): T[] {
  const bySku = new Map<string, Metadata[]>();
  for (const entry of catalog) {
    const key = entry.sku.trim().toUpperCase();
    bySku.set(key, [...(bySku.get(key) ?? []), entry]);
  }
  return rows.map((row) => {
    const result = {...row};
    const matches = bySku.get(row.sku.trim().toUpperCase()) ?? [];
    for (const key of ['upc', 'itemId', 'productName'] as const) {
      if (row[key]?.trim()) continue;
      const values = [...new Set(matches.map((entry) => entry[key]?.trim()).filter(Boolean))];
      if (values.length === 1 && values[0]!.length <= (key === 'productName' ? 255 : 32)) result[key] = values[0]!;
    }
    return result;
  });
}

async function enrich<T extends Metadata>(tenantId: string, rows: T[]): Promise<T[]> {
  if (!rows.some((row) => !row.upc || !row.itemId || !row.productName)) return rows;
  const skus = [...new Set(rows.map((row) => row.sku.trim().toUpperCase()))];
  if (!skus.length) return rows;
  const [raw] = await createDb().pool.query(
    "SELECT sku, item_id AS itemId, product_name AS productName, JSON_EXTRACT(payload, '$.values.UPC') AS upcValue FROM smartsheet_allsku_rows WHERE tenant_id=? AND UPPER(TRIM(sku)) IN (?)",
    [tenantId, skus],
  );
  const catalog = (raw as Array<Metadata & {upcValue: unknown}>).map((row) => {
    let value = row.upcValue;
    if (typeof value === 'string') {try {value = JSON.parse(value);} catch { /* scalar UPC */ }}
    const upc = Array.isArray(value) ? value.map((cell) => typeof cell === 'object' && cell ? cell.text ?? '' : String(cell)).join('').trim() : typeof value === 'string' ? value.trim() : '';
    return {...row, upc};
  });
  return fillCostMetadata(rows, catalog);
}

export async function costTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('成本表');
  sheet.addRow([...columns, ...feeColumns]);
  sheet.columns.forEach((column, index) => { column.width = index === 3 ? 32 : 22; });
  sheet.getRow(1).font = {bold: true, color: {argb: 'FFFFFFFF'}};
  sheet.getRow(1).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF147D68'}};
  sheet.getRow(1).height = 28;
  sheet.getColumn(1).numFmt = '@';
  sheet.getColumn(2).numFmt = '@';
  sheet.getColumn(3).numFmt = '@';
  sheet.views = [{state: 'frozen', ySplit: 1}];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function optionalFee(value: unknown, commission = false) {
  const result = String(value ?? '').trim();
  if (!result) return null;
  if (!/^\d{1,12}(?:\.\d{1,12})?$/.test(result) ||
      (commission && (Number(result) > 100 || (result.split('.')[1]?.length ?? 0) > 6))) {
    throw new InvalidCost(commission ? '佣金率须在 0 至 100% 之间，最多六位小数' : '尾程单价须为非负数字，最多十二位小数');
  }
  return result;
}

export async function saveWfsCosts(tenantId: string, period: string, rows: Cost[], importMode = false) {
  const { pool } = createDb();
  const connection = await pool.getConnection();
  let stats = { inserted: 0, updated: 0 };
  try {
    await connection.beginTransaction();
    const existing = await existingCosts(tenantId, rows, connection, true);
    const known = new Set(existing.map(row => row.sku.trim().toUpperCase()));
    stats = { inserted: rows.filter(row => !known.has(row.sku)).length, updated: rows.filter(row => known.has(row.sku)).length };
    // Merge existing values before ALLSKU enrichment, so catalog defaults never
    // replace stored values when the spreadsheet cell was blank.
    rows = await enrich(tenantId, importMode ? mergeCostImport(rows, existing) : rows);
    const values = rows.map(row => [tenantId, period, row.sku, row.upc, row.itemId, row.productName, row.purchaseCost, row.freightCost]);
    await connection.query(
      `INSERT INTO wfs_costs (tenant_id, period, sku, upc, item_id, product_name, purchase_cost, freight_cost)
       VALUES ? ON DUPLICATE KEY UPDATE upc=VALUES(upc), item_id=VALUES(item_id), product_name=VALUES(product_name),
       purchase_cost=VALUES(purchase_cost), freight_cost=VALUES(freight_cost)`, [values],
    );
    const overrides = new Map<number, Array<[string, string, string | null, string | null]>>();
    for (const row of rows) {
      const mask = Number(row.manualLastMile !== undefined) + 2 * Number(row.manualCommissionPercent !== undefined);
      if (!mask) continue;
      const group = overrides.get(mask) ?? [];
      group.push([tenantId, row.sku, row.manualLastMile ?? null, row.manualCommissionPercent ?? null]);
      overrides.set(mask, group);
    }
    for (const [mask, group] of overrides) {
      const updates = [];
      if (mask & 1) updates.push('last_mile=VALUES(last_mile)');
      if (mask & 2) updates.push('commission_percent=VALUES(commission_percent)');
      await connection.query(
        `INSERT INTO wfs_cost_fee_overrides (tenant_id, sku, last_mile, commission_percent)
         VALUES ? ON DUPLICATE KEY UPDATE ${updates.join(', ')}`, [group],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await invalidateMonthlyProfit(tenantId);
  return stats;
}

export function wfsCostsRouter(): Router {
  const router = Router();
  router.use('/wfs-costs', async (req, res, next) => {
    try {
      const session = await requestSession(req, false);
      if (session?.role !== 'admin') return res.status(session ? 403 : 401).json({ error: { message: '仅管理员可访问成本表' } });
      res.locals.costTenant = session.tenantId;
      res.set('Cache-Control', 'no-store');
      return next();
    } catch (error) { return next(error); }
  });

  router.get('/wfs-costs/template', async (_req, res, next) => {
    try {
      res.type(xlsxType).attachment('cost-import-template.xlsx').send(await costTemplate());
    } catch (error) { return next(error); }
  });

  router.get('/wfs-costs', async (req, res, next) => {
    try {
      const [rows] = await createDb().pool.query(
        `SELECT c.period, c.sku, c.upc, c.item_id AS itemId, c.product_name AS productName,
           c.purchase_cost AS purchaseCost, c.freight_cost AS freightCost,
           f.last_mile AS manualLastMile, f.commission_percent AS manualCommissionPercent,
           lx.unit_cost AS lingxingPurchaseCost, lx.quantity AS lingxingPurchaseQuantity
         FROM wfs_costs c
         LEFT JOIN wfs_cost_fee_overrides f ON f.tenant_id=c.tenant_id AND f.sku=c.sku
         LEFT JOIN (
           SELECT UPPER(TRIM(msku)) COLLATE utf8mb4_0900_ai_ci AS walmart_sku,
                  SUM(line_purchase_cost) / NULLIF(SUM(shipped_quantity),0) AS unit_cost,
                  SUM(shipped_quantity) AS quantity
           FROM lingxing_shipment_sku_costs
           WHERE tenant_id=? AND shipping_status='2' AND currency='CNY'
             AND shipped_quantity>0 AND purchase_unit_cost>0 AND line_purchase_cost>0
             AND NULLIF(TRIM(msku),'') IS NOT NULL AND NULLIF(TRIM(sku),'') IS NOT NULL
           GROUP BY walmart_sku
           HAVING COUNT(DISTINCT UPPER(TRIM(sku)))=1
         ) lx ON lx.walmart_sku=c.sku
         WHERE c.tenant_id=? ORDER BY c.period, c.sku`, [res.locals.costTenant,res.locals.costTenant],
      );
      const costs = rows as Array<Cost & {period: string}>;
      const [enriched, averages] = await Promise.all([
        enrich(res.locals.costTenant, costs),
        req.query.lastMile === '1'
          ? wfsPaymentAverages(res.locals.costTenant, costs.map((row) => row.sku.trim().toUpperCase()))
          : Promise.resolve(null),
      ]);
      return res.json({ data: enriched.map((row) => {
        const sku = row.sku.trim().toUpperCase();
        const sample = averages?.lastMile.get(sku);
        const commission = averages?.commission.get(sku);
        return {...row, lastMileAverage: sample ? sample.amount / sample.units : null, lastMileUnits: sample?.units ?? 0, commissionRate: commission ? commission.commission / commission.sales : null};
      }) });
    } catch (error) { return next(error); }
  });

  router.post('/wfs-costs', async (req, res, next) => {
    try {
      if (!req.is('application/json')) return res.sendStatus(415);
      const period = field(req.body?.period, 64, true);
      await saveWfsCosts(res.locals.costTenant, period, [{
        ...cost(req.body),
        manualLastMile: req.body.manualLastMile === undefined ? undefined : optionalFee(req.body.manualLastMile),
        manualCommissionPercent: req.body.manualCommissionPercent === undefined ? undefined : optionalFee(req.body.manualCommissionPercent, true),
      }]);
      return res.json({ data: { count: 1 } });
    } catch (error) {
      if (error instanceof InvalidCost) return res.status(400).json({ error: { message: error.message } });
      return next(error);
    }
  });

  router.post('/wfs-costs/import', raw({ type: xlsxType, limit: '2mb' }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
      const period = field(req.query.sheet, 64, true);
      const parsed = await parseWfsCosts(req.body, period);
      if (req.query.commit === '1') {
        const stats = await saveWfsCosts(res.locals.costTenant, period, parsed, true);
        return res.json({ data: { period, count: parsed.length, ...stats } });
      }
      const existing = await existingCosts(res.locals.costTenant, parsed);
      const rows = await enrich(res.locals.costTenant, mergeCostImport(parsed, existing));
      const [savedFees] = await createDb().pool.query(
        'SELECT sku, last_mile AS manualLastMile, commission_percent AS manualCommissionPercent FROM wfs_cost_fee_overrides WHERE tenant_id=? AND sku IN (?)',
        [res.locals.costTenant, rows.slice(0, 8).map(row => row.sku)],
      );
      const feesBySku = new Map((savedFees as Cost[]).map(row => [row.sku.trim().toUpperCase(), row]));
      const previewRows = rows.slice(0, 8).map(row => ({
        ...row,
        manualLastMile: row.manualLastMile ?? feesBySku.get(row.sku)?.manualLastMile,
        manualCommissionPercent: row.manualCommissionPercent ?? feesBySku.get(row.sku)?.manualCommissionPercent,
      }));
      const known = new Set(existing.map(row => row.sku.trim().toUpperCase()));
      return res.json({ data: { period, count: rows.length, inserted: rows.filter(row => !known.has(row.sku)).length, updated: rows.filter(row => known.has(row.sku)).length, rows: rows.slice(0, 8) } });
    } catch (error) {
      if (error instanceof InvalidCost) return res.status(400).json({ error: { message: error.message } });
      return next(error);
    }
  });
  return router;
}
