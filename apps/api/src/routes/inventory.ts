import {inventoryReconRows,inventoryReconWorkbook} from './inventory-recon-export.js';
import {shipmentReceiptTotals} from '../../../../packages/db/src/wfs-receipts.js';
import {latestInventoryHealth} from '../../../../packages/db/src/normalization/inventory-health.js';
import { Router, type Request } from 'express';
import { authenticatedSession } from './auth.js';
import type { OrderVisibility } from './orders.js';
import { and, createDb, eq, inArray, inventorySnapshots, rawPayloads, reconTransactions, skus, smartSheetAllSkuRows, stores, storageFees } from '@walmart-erp/db';
import { canViewStoreSku, filterVisibleSkuRows } from './sku-visibility.js';
import { buildAllSkuChineseNameMap } from './allskuOwnerMapping.js';
import { productImageUrl } from './product-images.js';
import type { CommerceQuery } from './commerce-source.js';
import { inventoryTransit, type TransitDetail } from './inventory-transit.js';
export interface InventoryRow { storeId:string; sku:string; productName?:string; chineseName?:string; imageUrl?:string; firstInStockDate?:string; ageDistribution?:Record<string, number>; nodeId?:string; quantity:number; reservedQuantity?:number; updatedAt:string; risk?:string; transitQuantity?:number; transitDetails?:TransitDetail[]; }
export function inventoryAge(updatedAt:string, now=new Date()):number { return Math.max(0,Math.floor((now.getTime()-new Date(updatedAt).getTime())/86400000)); }
export function mysqlRows<T>(result: [T[], unknown]): T[] { return result[0]; }
export function inventoryLogPagination(query: { page?: unknown; pageSize?: unknown }) {
  const pageValue = Number(query.page);
  const sizeValue = Number(query.pageSize);
  const page = Number.isFinite(pageValue) ? Math.max(1, Math.floor(pageValue)) : 1;
  const pageSize = Number.isFinite(sizeValue) && sizeValue > 0 ? Math.min(100, Math.max(1, Math.floor(sizeValue))) : 50;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function reconcileInventory(expected:InventoryRow[],actual:InventoryRow[]) { const a=new Map(actual.map(x=>[`${x.storeId}:${x.sku}`,x.quantity])); return expected.map(x=>({...x,delta:(a.get(`${x.storeId}:${x.sku}`)??0)-x.quantity})); }
function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  const us = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}
export function storageFeePeriod(rows: unknown[], month?: string): { startDate: string | null; endDate: string | null } {
  const periods = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    const description = String(value.description ?? '').trim().toLowerCase();
    if (description !== 'wfs storagefee') return [];
    const startDate = dateValue(value.periodStartDate);
    const endDate = dateValue(value.periodEndDate);
    if (month && endDate?.slice(0, 7) !== month) return [];
    return startDate || endDate ? [{ startDate, endDate }] : [];
  });
  return { startDate: periods.reduce<string | null>((min, row) => row.startDate && (!min || row.startDate < min) ? row.startDate : min, null), endDate: periods.reduce<string | null>((max, row) => row.endDate && (!max || row.endDate > max) ? row.endDate : max, null) };
}
export function inventorySkuKey(storeId: unknown, sku: unknown): string | undefined {
  const normalizedSku = String(sku ?? '').trim().toLocaleUpperCase('en-US');
  return normalizedSku ? `${String(storeId ?? '')}:${normalizedSku}` : undefined;
}
export function filterInventory(rows:InventoryRow[], q:{sku?:string;productName?:string;nodeId?:string;storeId?:string;risk?:string;minAge?:number;maxAge?:number}, now=new Date()) { return rows.filter(r=>(!q.sku||String(r.sku ?? '').toLowerCase().includes(String(q.sku ?? '').toLowerCase()))&&(!q.productName||`${r.productName ?? ''} ${r.chineseName ?? ''}`.toLowerCase().includes(q.productName.toLowerCase()))&&(!q.storeId||r.storeId===q.storeId)&&(!q.risk||r.risk===q.risk)&&(!q.minAge||inventoryAge(r.updatedAt,now)>=q.minAge)&&(!q.maxAge||inventoryAge(r.updatedAt,now)<=q.maxAge)); }
export function latestInventoryPayloads<T extends { storeId:string; receivedAt:Date }>(rows:T[]):T[] {
  const latestByStore = new Map<string, number>();
  for (const row of rows) latestByStore.set(row.storeId, Math.max(latestByStore.get(row.storeId) ?? 0, row.receivedAt.getTime()));
  return rows.filter(row => row.receivedAt.getTime() === latestByStore.get(row.storeId));
}
type InventorySnapshotInput = { storeId: string; sku: string; nodeId: string; quantity: string | number; occurredAt: Date | string };
type InventoryHealthMeta = { productName?: string; firstInStockDate?: string; ageDistribution?: Record<string, number>; reservedQuantity?: number };
type InventoryDisplayMeta = { chineseName?: string; imageUrl?: string };
export function inventorySnapshotRecord(snapshot: InventorySnapshotInput, health: InventoryHealthMeta = {}, display: InventoryDisplayMeta = {}): InventoryRow {
  const occurredAt = snapshot.occurredAt instanceof Date ? snapshot.occurredAt : new Date(snapshot.occurredAt);
  const quantity = Number(snapshot.quantity);
  return {
    storeId: snapshot.storeId,
    sku: snapshot.sku,
    nodeId: snapshot.nodeId,
    quantity,
    productName: health.productName,
    firstInStockDate: health.firstInStockDate,
    ageDistribution: health.ageDistribution,
    reservedQuantity: health.reservedQuantity,
    chineseName: display.chineseName,
    imageUrl: display.imageUrl,
    updatedAt: occurredAt.toISOString(),
    risk: quantity <= 0 ? 'stockout' : quantity >= 100 ? 'overstock' : 'normal',
  };
}
export function mysqlInventorySource() {
  const { db, pool } = createDb();
  const cache = new Map<string, { expiresAt: number; value?: InventoryRow[]; pending?: Promise<InventoryRow[]> }>();
  const load = async (tenantId:string):Promise<InventoryRow[]> => {
    const [snapshotResult, healthRows] = await Promise.all([
      pool.query(
        `SELECT i.store_id AS storeId,s.external_id AS sku,i.node_id AS nodeId,i.quantity,i.occurred_at AS occurredAt
         FROM (
           SELECT id,ROW_NUMBER() OVER (PARTITION BY store_id,sku_id,node_id ORDER BY occurred_at DESC,id DESC) row_num
           FROM inventory_snapshots FORCE INDEX(inventory_snapshot_latest_idx) WHERE tenant_id=?
         ) latest
         JOIN inventory_snapshots i ON i.id=latest.id
         JOIN skus s ON s.tenant_id=i.tenant_id
           AND (s.id=i.sku_id OR CONCAT(i.store_id, ':', UPPER(s.external_id))=UPPER(i.sku_id))
         WHERE latest.row_num=1`,
        [tenantId],
      ) as unknown as Promise<[InventorySnapshotInput[], unknown]>,
      latestInventoryHealth(pool,tenantId),
    ]);
    const snapshotRows = mysqlRows(snapshotResult).filter((row) => inventorySkuKey(row.storeId, row.sku));
    const activeStoreIds = [...new Set(snapshotRows.map((row) => row.storeId))];
    const activeSkuKeys = new Set(snapshotRows.map((row) => inventorySkuKey(row.storeId, row.sku)!));
    const namesPromise = activeStoreIds.length
      ? db.select({ storeId: skus.storeId, sku: skus.externalId, title: skus.title, imageUrl: skus.imageUrl }).from(skus).where(and(eq(skus.tenantId, tenantId), inArray(skus.storeId, activeStoreIds)))
      : Promise.resolve([] as Array<{ storeId: string; sku: string; title: string | null; imageUrl: string | null }>);
    const allSkuRowsPromise = activeStoreIds.length
      ? db.select({ sku: smartSheetAllSkuRows.sku, storeName: smartSheetAllSkuRows.storeName, productName: smartSheetAllSkuRows.productName }).from(smartSheetAllSkuRows).where(eq(smartSheetAllSkuRows.tenantId, tenantId))
      : Promise.resolve([] as Array<{ sku:string|null; storeName:string|null; productName:string|null }>);
    const storesPromise = activeStoreIds.length
      ? db.select({ id: stores.id, name: stores.name }).from(stores).where(and(eq(stores.tenantId, tenantId), inArray(stores.id, activeStoreIds)))
      : Promise.resolve([] as Array<{ id: string; name: string }>);
    const [names, allSkuRows, tenantStores] = await Promise.all([namesPromise, allSkuRowsPromise, storesPromise]);
    const activeNames = names.filter((row) => { const key = inventorySkuKey(row.storeId, row.sku); return key !== undefined && activeSkuKeys.has(key); });
    const productNames = new Map(activeNames.map((row) => [inventorySkuKey(row.storeId, row.sku)!, row.title ?? undefined]));
    const productImages = new Map(activeNames.map((row) => [inventorySkuKey(row.storeId, row.sku)!, row.imageUrl?.trim() || undefined]));
    const chineseNames = buildAllSkuChineseNameMap(allSkuRows, tenantStores);
    const health = new Map<string, InventoryHealthMeta>();
    for (const row of healthRows) { const key=inventorySkuKey(row.storeId,row.sku)!; health.set(`${key}:${row.nodeId}`,row); if(!health.has(key))health.set(key,row); }
    const headResult = await pool.query(`SELECT id, store_id AS storeId, sku, wfs_shipment_number AS shipmentId, shipped_at AS shippedAt, quantity, contract_number AS contractNumber, purchase_batch_number AS purchaseBatchNumber, freight_forwarder_inbound_number AS inboundNumber, received_at AS receivedAt FROM head_freight_rows WHERE tenant_id = ? AND store_id IS NOT NULL AND TRIM(COALESCE(shipped_at, '')) <> ''`, [tenantId]);
    const receiptRows = await shipmentReceiptTotals(pool,tenantId,(headResult[0] as any[]).map(row=>String(row.shipmentId??'').trim().toUpperCase()).filter(Boolean));
    const transit = inventoryTransit(headResult[0] as any[], receiptRows);
    const transitAssigned = new Set<string>();
    return snapshotRows.map((snapshot) => {
      const skuKey = inventorySkuKey(snapshot.storeId, snapshot.sku)!;
      const meta = health.get(`${skuKey}:${snapshot.nodeId}`) ?? health.get(skuKey);
      const movement = !transitAssigned.has(skuKey) ? transit.get(skuKey) : undefined;
      transitAssigned.add(skuKey);
      return { ...inventorySnapshotRecord(snapshot, { ...meta, productName: meta?.productName ?? productNames.get(skuKey) }, { chineseName: chineseNames.get(skuKey), imageUrl: productImages.get(skuKey) }), transitQuantity: movement?.quantity ?? 0, transitDetails: movement?.details ?? [] };
    });
  };
  return async (tenantId: string): Promise<InventoryRow[]> => {
    const now = Date.now();
    const cached = cache.get(tenantId);
    if (cached?.value && cached.expiresAt > now) return cached.value;
    if (cached?.pending) return cached.pending;
    const pending = load(tenantId).then((value) => { cache.set(tenantId, { value, expiresAt: Date.now() + 5_000 }); return value; }).finally(() => {
      const current = cache.get(tenantId);
      if (current?.pending) cache.set(tenantId, { expiresAt: current.expiresAt, value: current.value });
    });
    cache.set(tenantId, { expiresAt: 0, pending });
    return pending;
  };
}
export function inventoryRouter(
  list: ((tenantId: string) => Promise<InventoryRow[]>) | (() => Promise<InventoryRow[]>) = async () => [],
  orders: (tenantId: string, query?: CommerceQuery) => Promise<Array<{ storeId: string; sku: string; quantity?: number | null; orderedAt?: string }>> = async () => [],
  visibility?: (req: Request) => OrderVisibility | Promise<OrderVisibility | undefined> | undefined,
): Router {
  const r = Router();
  r.get('/inventory/reconciliation/export', async (req,res,next) => {
    try {
      const session=await authenticatedSession(req.headers.cookie);
      const scope=session?.tenantId&&visibility ? await visibility(req) : undefined;
      if(!session?.tenantId||!scope)return res.status(401).json({error:{message:'请先登录'}});
      const month=req.query.month;
      if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:{message:'请选择有效月份'}});
      const workbook=await inventoryReconWorkbook(month,await inventoryReconRows(session.tenantId,month),scope);
      return res.set('Cache-Control','no-store').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('inventory-reconciliation-'+month+'.xlsx').send(workbook);
    }catch(error){return next(error);}
  });
  r.get('/inventory/storage-fees', async (req, res, next) => {
    try {
      const session = await authenticatedSession(req.headers.cookie);
      if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const requestedMonth = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
      const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
      const scope = visibility ? await visibility(req) : undefined;
      if (!scope) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      if (storeId && scope.role !== 'admin' && !scope.storeIds.has(storeId) && ![...scope.skus].some((key) => key.startsWith(`${storeId}:`))) return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: 'Store access required' } });
      if (scope.role !== 'admin') return res.json({ requestId: res.locals.requestId, data: { month: requestedMonth ?? null, amount: null, currency: null, period: { startDate: null, endDate: null }, rows: [], dataAvailable: false }, error: null });
      const { db, pool } = createDb();
      try {
        let month = requestedMonth;
        if (!month) {
          const candidates = await db.select({ month: storageFees.month, storeId: storageFees.storeId }).from(storageFees).where(and(eq(storageFees.tenantId, session.tenantId), ...(storeId ? [eq(storageFees.storeId, storeId)] : [])));
          month = candidates.map((row) => row.month).sort().at(-1);
        }
        if (!month) return res.json({ requestId: res.locals.requestId, data: { month: null, amount: null, currency: null, period: { startDate: null, endDate: null }, rows: [], dataAvailable: false }, error: null });
        const rows = await db.select({ storeId: storageFees.storeId, feeType: storageFees.feeType, amount: storageFees.amount, currency: storageFees.currency }).from(storageFees).where(and(eq(storageFees.tenantId, session.tenantId), eq(storageFees.month, month), ...(storeId ? [eq(storageFees.storeId, storeId)] : [])));
        const visible = rows;
        const currencies = [...new Set(visible.map((row) => row.currency))];
        const amount = visible.length ? Number(visible.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)) : null;
        const reportRows = await db.select({ periodStartDate: reconTransactions.periodStartDate, periodEndDate: reconTransactions.periodEndDate, description: reconTransactions.description }).from(reconTransactions).where(and(
          eq(reconTransactions.tenantId, session.tenantId),
          eq(reconTransactions.reportMonth, month),
          eq(reconTransactions.description, 'WFS StorageFee'),
          ...(storeId ? [eq(reconTransactions.storeId, storeId)] : []),
        ));
        const period = storageFeePeriod(reportRows, month);
        return res.json({ requestId: res.locals.requestId, data: { month, amount, currency: currencies.length === 1 ? currencies[0] : null, period, rows: visible }, error: null });
      } finally { await pool.end(); }
    } catch (e) { return next(e); }
  });
  r.get('/inventory/:sku/logs', async (req, res, next) => {
    try {
      const session = await authenticatedSession(req.headers.cookie);
      if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
      const scope = visibility ? await visibility(req) : undefined;
      if (!scope) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      if (storeId && scope.role !== 'admin' && !canViewStoreSku(scope, storeId, req.params.sku)) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Inventory SKU not found' } });
      const pagination = inventoryLogPagination(req.query);
      let storeIds: string[] | undefined = storeId ? [storeId] : undefined;
      if (!storeId && scope.role !== 'admin') {
        const assignedSkuStores = [...scope.skus].flatMap((grant) => {
          const separator = grant.indexOf(':');
          return separator >= 0 && grant.slice(separator + 1).trim().toLocaleUpperCase('en-US') === req.params.sku.trim().toLocaleUpperCase('en-US') ? [grant.slice(0, separator)] : [];
        });
        storeIds = [...new Set([...scope.storeIds, ...assignedSkuStores])];
        if (!storeIds.length) return res.status(404).json({ requestId: res.locals.requestId, data: null, error: { message: 'Inventory SKU not found' } });
      }
      const conditions = ['tenant_id = ?', 'sku = ?'];
      const params: unknown[] = [session.tenantId, req.params.sku];
      if (storeIds) { conditions.push(`store_id IN (${storeIds.map(() => '?').join(',')})`); params.push(...storeIds); }
      const where = conditions.join(' AND ');
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const { db, pool } = createDb();
      try {
        const [[pageRows], [countRows], [monthlyRows]] = await Promise.all([
          pool.query(`SELECT id, store_id AS storeId, sku, gtin, fc_id AS fcId, fc_name AS fcName, changed_units AS changedUnits, transaction_time AS transactionTime, transaction_location AS transactionLocation, reason_code AS reasonCode, reason_description AS reasonDescription, transaction_type AS transactionType, shipment_id AS shipmentId, created_at AS createdAt FROM wfs_inventory_logs WHERE ${where} ORDER BY transaction_time DESC, id DESC LIMIT ? OFFSET ?`, [...params, pagination.pageSize, pagination.offset]) as Promise<[Array<Record<string, unknown>>, unknown]>,
          pool.query(`SELECT COUNT(*) AS total FROM wfs_inventory_logs WHERE ${where}`, params) as Promise<[Array<{ total: number | string }>, unknown]>,
          pool.query(`SELECT COALESCE(SUM(changed_units), 0) AS net, COALESCE(SUM(GREATEST(0, -changed_units)), 0) AS outbound, COALESCE(SUM(CASE WHEN LOWER(COALESCE(reason_description, '')) LIKE '%shipped to customer%' THEN GREATEST(0, -changed_units) ELSE 0 END), 0) AS salesOutbound, COALESCE(SUM(GREATEST(0, changed_units)), 0) AS inbound FROM wfs_inventory_logs WHERE ${where} AND transaction_time >= ?`, [...params, monthStart]) as Promise<[Array<Record<string, number | string>>, unknown]>,
        ]);
        const sorted = pageRows.filter((row) => canViewStoreSku(scope, String(row.storeId), String(row.sku)));
        const total = Number(countRows[0]?.total ?? 0);
        const monthly = monthlyRows[0] ?? {};
        const monthlyNet = Number(monthly.net ?? 0);
        const outbound = Number(monthly.outbound ?? 0);
        const salesOutbound = Number(monthly.salesOutbound ?? 0);
        const inbound = Number(monthly.inbound ?? 0);
        const salesLines = (await orders(session.tenantId, { ...(storeId ? { storeId } : {}), sku: req.params.sku, orderedAtOrAfter: monthStart })).filter((line) => canViewStoreSku(scope, line.storeId, line.sku) && !!line.orderedAt && new Date(line.orderedAt).getTime() >= monthStart.getTime());
        const salesQuantity = salesLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        return res.json({ requestId: res.locals.requestId, data: { rows: sorted, total, page: pagination.page, pageSize: pagination.pageSize, summary: { salesQuantity, monthlyNet, outbound, salesOutbound, inbound, salesOutboundDifference: salesQuantity - salesOutbound, monthStart: monthStart.toISOString() } }, error: null });
      } finally { await pool.end(); }
    } catch (e) { return next(e); }
  });
  r.get('/inventory', async (req, res, next) => {
    try {
      const session = await authenticatedSession(req.headers.cookie);
      const tenantId = session?.tenantId;
      if (!tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const q: any = {};
      for (const k of ['sku', 'productName', 'nodeId', 'storeId', 'risk']) if (typeof req.query[k] === 'string') q[k] = req.query[k];
      if (req.query.minAge) q.minAge = Number(req.query.minAge);
      if (req.query.maxAge) q.maxAge = Number(req.query.maxAge);
      const rows = await (list as any)(tenantId);
      const scope = visibility ? await visibility(req) : undefined;
      if (!scope) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      return res.json({ requestId: res.locals.requestId, data: { rows: filterInventory(filterVisibleSkuRows(rows, scope), q) }, error: null });
    } catch (e) { return next(e); }
  });
  return r;
}
