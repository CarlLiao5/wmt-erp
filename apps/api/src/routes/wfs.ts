import { shipmentReceiptTotals } from '../../../../packages/db/src/wfs-receipts.js';
import { WfsShipmentRepository } from '../../../../packages/db/src/wfs-shipments.js';
import { Router, type Request, type Router as ExpressRouter } from 'express';
import { authenticatedSession } from './auth.js';
import { and, createDb, eq, freightTrackingEvents, freightTrackingRoutes, gte, headFreightRows, inArray, lte, rawPayloads, skus, wfsFeePreviewItems, wfsFeePreviewOptions, wfsFeePreviewRuns, wfsInventoryLogs } from '@walmart-erp/db';
import type { OrderVisibility } from './orders.js';
import { canViewStoreSku } from './sku-visibility.js';
import ExcelJS from 'exceljs';
export interface WfsHistoryRow { id?: string; status?: string; occurredAt?: string; [key:string]: unknown }
type WfsTrackingEvent = { eventTimeText: string; eventAt: Date | null; info: string; eventCode: string; routeOrder: number; isCompleted: boolean | null };
type WfsTracking = { inboundNumber: string; brand: string; currentStatus: string; currentStatusText: string; lastEventAt: Date | null; events: WfsTrackingEvent[] };
export function enforceReconciliationInterval(lastRun: Date|undefined, now=new Date(), minMs=3600000): boolean { return !lastRun || now.getTime()-lastRun.getTime()>=minMs; }
export function resolveWfsReceipt(actualShippedQty: number|undefined, actualReceivedQty: number|undefined) {
  return {
    actualShippedQty,
    actualReceivedQty,
    fullyReceived: actualShippedQty != null && actualReceivedQty != null ? actualReceivedQty >= actualShippedQty : undefined,
  };
}
type WfsItemPayloadRow = { storeId: string | null; payload: unknown };
export function groupWfsShipmentItems(rows: WfsItemPayloadRow[]): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  const seenByShipment = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.storeId || !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) continue;
    const payload = row.payload as Record<string, unknown>;
    const shipmentId = String(payload.shipmentId ?? payload.inboundOrderId ?? '').trim().toUpperCase();
    if (!shipmentId) continue;
    const shipmentKey = `${row.storeId}:${shipmentId}`;
    const item: Record<string, unknown> = { ...payload, storeId: row.storeId };
    // The item endpoint can return the same SKU more than once with volatile
    // display fields (for example fill rate). Keep one row per shipment/SKU so
    // the detail table and actual quantity totals do not double-count it.
    const itemKey = normalizeSku(item.sku ?? (item.item as Record<string, unknown> | undefined)?.sku ?? item.itemId);
    const seen = seenByShipment.get(shipmentKey) ?? new Set<string>();
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    seenByShipment.set(shipmentKey, seen);
    const items = grouped.get(shipmentKey) ?? [];
    items.push(item);
    grouped.set(shipmentKey, items);
  }
  return grouped;
}
function normalizeSku(value: unknown) { return String(value ?? '').trim().toUpperCase(); }
export function filterWfsShipmentItemRows(rows: WfsItemPayloadRow[], shipmentKeys: Map<string, Set<string>>): WfsItemPayloadRow[] {
  const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
  return rows.filter((row) => {
    if (!row.storeId || !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) return false;
    const payload = row.payload as Record<string, unknown>;
    const keySet = shipmentKeys.get(row.storeId);
    if (!keySet) return false;
    return keySet.has(normalize(payload.shipmentId)) || keySet.has(normalize(payload.inboundOrderId));
  });
}
type WfsHeadFreightQuantity = { storeId?: unknown; shipmentNumber?: unknown; sku?: unknown; quantity?: unknown };
type WfsInventoryReceipt = { storeId?: unknown; shipmentId?: unknown; sku?: unknown; changedUnits?: unknown; reasonDescription?: unknown };
export function attachWfsHeadFreight<T extends WfsHistoryRow>(rows: T[], headRows: Array<WfsHeadFreightQuantity & { inboundNumber?: unknown }>): Array<T & { headFreightItems: Array<{ sku: unknown; quantity: unknown; inboundNumber: unknown }> }> {
  const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
  return rows.map((row) => {
    const matches = headRows.filter((head) => String(head.storeId ?? '') === String(row.storeId ?? '')
      && normalize(head.shipmentNumber) === normalize(row.shipmentId ?? row.inboundOrderId));
    return { ...row, headFreightItems: matches.map((head) => ({ sku: head.sku, quantity: head.quantity, inboundNumber: head.inboundNumber })) };
  });
}
export type WfsReceiptLog = { id: string; storeId: string; shipmentId: string | null; sku: string; gtin: string; changedUnits: number | null; fcId: string | null; fcName: string | null; transactionTime: Date | null; transactionLocation: string | null; reasonCode: string | null; reasonDescription: string | null; transactionType: string | null };
export function wfsReceiptRows(rows: WfsReceiptLog[], storeId: string, shipmentId: string): WfsReceiptLog[] {
  const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
  return rows.filter((row) => normalize(row.storeId) === normalize(storeId)
    && normalize(row.shipmentId) === normalize(shipmentId)
    && /^(Received|Receiving Correction)/i.test(row.reasonDescription ?? ''));
}
export async function wfsReceiptWorkbook(shipmentId: string, rows: WfsReceiptLog[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('实际上架明细', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(['货件号', 'SKU', 'GTIN', '上架数量', '仓库节点', '仓库名称', '交易时间', '交易位置', '类型', '原因代码', '原因']);
  for (const row of rows) sheet.addRow([shipmentId, row.sku, row.gtin, row.changedUnits, row.fcId, row.fcName, row.transactionTime, row.transactionLocation, row.transactionType, row.reasonCode, row.reasonDescription]);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B61' } };
  sheet.getRow(1).height = 25;
  sheet.columns.forEach((column, index) => { column.width = [20, 24, 18, 14, 16, 24, 22, 24, 18, 24, 32][index] ?? 20; });
  sheet.getColumn(4).numFmt = '#,##0;[Red]-#,##0';
  sheet.getColumn(7).numFmt = 'yyyy-mm-dd hh:mm:ss';
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export function aggregateWfsActualQuantities(headRows: WfsHeadFreightQuantity[], inventoryRows: WfsInventoryReceipt[]) {
  const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
  const keyOf = (storeId: unknown, shipmentId: unknown, sku: unknown) => storeId ? `${String(storeId).trim()}:${normalize(shipmentId)}:${normalize(sku)}` : `${normalize(shipmentId)}:${normalize(sku)}`;
  const shippedByKey = new Map<string, number>();
  const shippedSeen = new Set<string>();
  for (const row of headRows) {
    const key = keyOf(row.storeId, row.shipmentNumber, row.sku);
    if (key.endsWith('::')) continue;
    const signature = `${key}:${String(row.quantity ?? '')}`;
    if (shippedSeen.has(signature)) continue;
    shippedSeen.add(signature);
    shippedByKey.set(key, (shippedByKey.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  const receivedByKey = new Map<string, number>();
  for (const row of inventoryRows) {
    if (!row.shipmentId || !row.reasonDescription || !/^(Received|Receiving Correction)/i.test(String(row.reasonDescription))) continue;
    const key = keyOf(row.storeId, row.shipmentId, row.sku);
    receivedByKey.set(key, (receivedByKey.get(key) ?? 0) + Number(row.changedUnits ?? 0));
  }
  return { shippedByKey, receivedByKey };
}
function numberTotal(items: Record<string, unknown>[], ...keys: string[]) {
  let found = false;
  const total = items.reduce((sum, item) => {
    for (const key of keys) {
      const value = Number(item[key]);
      if (item[key] != null && Number.isFinite(value)) { found = true; return sum + value; }
    }
    return sum;
  }, 0);
  return found ? total : undefined;
}

export function filterVisibleWfsRows(rows: WfsHistoryRow[], visibility: OrderVisibility, kind: 'shipments'|'reconciliations' = 'shipments'): WfsHistoryRow[] {
  if (visibility.role === 'admin') return rows;
  if (kind === 'reconciliations') return [];
  return rows.flatMap((row) => {
    const storeId = typeof row.storeId === 'string' ? row.storeId : '';
    const rawItems = Array.isArray(row.items) ? row.items as Record<string, unknown>[] : [];
    const items = rawItems.filter((item) => {
      const sku = String(item.sku ?? (item.item as Record<string, unknown> | undefined)?.sku ?? item.itemId ?? '').trim();
      const itemStoreId = typeof item.storeId === 'string' ? item.storeId : storeId;
      return !!itemStoreId && !!sku && canViewStoreSku(visibility, itemStoreId, sku);
    });
    if (!items.length) return [];
    const rawFeePreviews = Array.isArray(row.feePreviews) ? row.feePreviews as Array<Record<string, unknown>> : [];
    const feePreviews = rawFeePreviews.map((preview) => {
      const allFeeItems = Array.isArray(preview.items) ? preview.items as Array<Record<string, unknown>> : [];
      const visibleFeeItems = allFeeItems.filter((item) => {
        const sku = String(item.sku ?? '').trim();
        return !!sku && canViewStoreSku(visibility, storeId, sku);
      });
      return { ...preview, totalNetTransferCharge: allFeeItems.length > 0 && visibleFeeItems.length === allFeeItems.length ? preview.totalNetTransferCharge : null, items: visibleFeeItems };
    });
    const rawHeadFreightItems = Array.isArray(row.headFreightItems) ? row.headFreightItems as Array<Record<string, unknown>> : [];
    const headFreightItems = rawHeadFreightItems.filter((item) => {
      const sku = String(item.sku ?? '').trim();
      return !!sku && canViewStoreSku(visibility, storeId, sku);
    });
    const shipmentUnits = numberTotal(items, 'itemQty', 'quantity', 'plannedQuantity');
    const receivedUnits = numberTotal(items, 'receivedQty', 'receivedQuantity', 'actualReceivedQty');
    const actualShippedUnits = numberTotal(items, 'actualShippedQty');
    const actualReceivedUnits = numberTotal(items, 'actualReceivedQty');
    const { id, status, occurredAt, shipmentId, inboundOrderId, trackingNo, carrierName, createdDate, expectedDeliveryDate, actualDeliveryDate, shipToAddress, tracking } = row;
    const fullyReceived = actualShippedUnits != null && actualReceivedUnits != null ? actualReceivedUnits >= actualShippedUnits : undefined;
    return [{ id, status, occurredAt, storeId, shipmentId, inboundOrderId, trackingNo, carrierName, createdDate, expectedDeliveryDate, actualDeliveryDate, shipToAddress, tracking, items, feePreviews, headFreightItems, shipmentUnits, receivedUnits, actualShippedUnits, actualReceivedUnits, fullyReceived }];
  });
}

export function wfsHistoryDateBounds(kind: 'shipments'|'reconciliations', from?: string, to?: string, now = Date.now()) {
  return {
    from: from ? new Date(from) : kind === 'reconciliations' ? new Date(now - 30 * 24 * 60 * 60 * 1000) : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  };
}

export function wfsShipmentIdentity(shipment: { storeId?: unknown; shipmentId?: unknown; inboundOrderId?: unknown; occurredAt?: unknown }) {
  return `${String(shipment.storeId ?? '')}\u0000${String(shipment.shipmentId ?? shipment.inboundOrderId ?? shipment.occurredAt ?? '')}`;
}

type FeePreviewJoinData = { runs: Array<Record<string, any>>; options: Array<Record<string, any>>; items: Array<Record<string, any>> };
export function attachWfsFeePreviews(rows: WfsHistoryRow[], data: FeePreviewJoinData & { tenantId: string }): WfsHistoryRow[] {
  const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
  const itsTransferHubIds = new Set(['4093', '4005', '2011']);
  const itsTransferHubNames = new Map([['LAX2T', '4093'], ['IND2T', '4005'], ['NJ3T', '2011']]);
  const keyOf = (storeId: unknown, shipmentId: unknown) => `${String(storeId ?? '')}\u0000${normalize(shipmentId)}`;
  const runs = new Map(data.runs.filter((run) => run.tenantId === data.tenantId).map((run) => [keyOf(run.storeId, run.shipmentId), run]));
  const itemsByOption = new Map<string, Record<string, any>[]>();
  for (const item of data.items) {
    if (item.tenantId !== data.tenantId) continue;
    const items = itemsByOption.get(String(item.optionId)) ?? [];
    items.push(item);
    itemsByOption.set(String(item.optionId), items);
  }
  const optionsByRun = new Map<string, Record<string, any>[]>();
  for (const option of data.options) {
    if (option.tenantId !== data.tenantId) continue;
    const options = optionsByRun.get(String(option.runId)) ?? [];
    options.push(option);
    optionsByRun.set(String(option.runId), options);
  }
  return rows.map((row) => {
    const run = runs.get(keyOf(row.storeId, row.shipmentId ?? row.inboundOrderId));
    const allOptions = run ? optionsByRun.get(String(run.id)) ?? [] : [];
    const shipToAddress = row.shipToAddress && typeof row.shipToAddress === 'object' ? row.shipToAddress as Record<string, unknown> : {};
    const rawDestination = normalize(shipToAddress.fcId ?? shipToAddress.shipNode ?? shipToAddress.nodeId ?? shipToAddress.fcName ?? shipToAddress.destinationName);
    const destinationNode = itsTransferHubIds.has(rawDestination) ? rawDestination : itsTransferHubNames.get(rawDestination);
    const matchingOptions = destinationNode ? allOptions.filter((option) => normalize(option.shipNode) === destinationNode) : [];
    const options = matchingOptions;
    return { ...row, feePreviews: options.map((option) => ({
      previewType: option.previewType,
      shipNode: option.shipNode,
      destinationName: option.destinationName ?? null,
      totalNetTransferCharge: option.totalNetTransferCharge,
      currency: option.currency,
      stale: !!run?.lastSuccessAt && !!run?.lastAttemptAt && run.lastAttemptAt > run.lastSuccessAt,
      lastAttemptAt: run?.lastAttemptAt ?? null,
      lastSuccessAt: run?.lastSuccessAt ?? null,
      items: (itemsByOption.get(String(option.id)) ?? []).filter((item) => item.storeId === option.storeId && item.shipmentId === option.shipmentId).map((item) => ({ gtin: item.gtin ?? null, sku: item.sku ?? null, itemQuantity: item.itemQuantity ?? null, netTransferCharge: item.netTransferCharge ?? null, unitTransferCharge: item.unitTransferCharge ?? null, currency: item.currency ?? null })),
    })) };
  });
}

export function wfsRouter(
  list: (kind?:'shipments'|'reconciliations', tenantId?:string, storeId?:string, from?:string, to?:string, view?:string, shipmentId?:string)=>Promise<WfsHistoryRow[]>=async()=>[],
  visibility?: (req: Request) => OrderVisibility | Promise<OrderVisibility | undefined> | undefined,
  receipts: (tenantId: string, storeId: string, shipmentId: string) => Promise<WfsReceiptLog[]> = async () => [],
): ExpressRouter {
  const r=Router();
  r.get('/wfs/shipments/:shipmentId/receipts/export', async (req, res, next) => {
    try {
      const session = await authenticatedSession(req.headers.cookie);
      const scope = visibility ? await visibility(req) : undefined;
      if (!session?.tenantId || !scope?.tenantId || scope.tenantId !== session.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      const storeId = typeof req.query.storeId === 'string' ? req.query.storeId.trim() : '';
      const shipmentId = String(req.params.shipmentId ?? '').trim();
      if (!storeId || !shipmentId) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: '店铺和货件号不能为空' } });
      const logs = wfsReceiptRows(await receipts(session.tenantId, storeId, shipmentId), storeId, shipmentId)
        .filter((row) => scope.role === 'admin' || canViewStoreSku(scope, row.storeId, row.sku));
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="wfs-receipts-${encodeURIComponent(shipmentId)}.xlsx"`);
      return res.send(await wfsReceiptWorkbook(shipmentId, logs));
    } catch (error) { return next(error); }
  });
  const handler=(kind:'shipments'|'reconciliations')=>async(req:Request,res:any,next:any)=>{
    try {
      const session=await authenticatedSession(req.headers.cookie);
      if(!session?.tenantId)return res.status(401).json({requestId:res.locals.requestId,data:null,error:{message:'Authenticated visibility scope required'}});
      const scope=visibility?await visibility(req):undefined;
      if(!scope)return res.status(401).json({requestId:res.locals.requestId,data:null,error:{message:'Authenticated visibility scope required'}});
      const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const view=req.query.view==='summary'?'summary':undefined;
      const shipmentId=typeof req.query.shipmentId==='string'?req.query.shipmentId:undefined;
      if(shipmentId&&!storeId)return res.status(400).json({data:null,error:{message:'店铺不能为空'}});
      const rows=await list(kind,session.tenantId,storeId,from,to,view,shipmentId);
      return res.json({requestId:res.locals.requestId,data:{rows:filterVisibleWfsRows(rows,scope,kind)},error:null});
    } catch(e) { return next(e); }
  };
  r.get('/wfs/shipments', handler('shipments')); r.get('/wfs/reconciliations', handler('reconciliations')); return r;
}

export function mysqlWfsHistorySource() {
  const { db, pool } = createDb();
  const cache = new Map<string, { expiresAt: number; value?: WfsHistoryRow[]; pending?: Promise<WfsHistoryRow[]>; staleUntil?:number }>();
  const load = async (kind:'shipments'|'reconciliations' = 'shipments', tenantId = '', storeId?: string, from?: string, to?: string, view?:string, shipmentId?:string):Promise<WfsHistoryRow[]> => {
    const resource = kind === 'shipments' ? 'wfs_shipments' : 'wfs_reconciliations';
    const bounds = wfsHistoryDateBounds(kind, from, to);
    if (kind !== 'shipments') {
      // Inventory logs are already normalized by the WFS worker. Do not scan
      // historical raw payloads just to rebuild the reconciliation list.
      const conditions = [eq(wfsInventoryLogs.tenantId, tenantId), ...(storeId ? [eq(wfsInventoryLogs.storeId, storeId)] : []), ...(bounds.from ? [gte(wfsInventoryLogs.transactionTime, bounds.from)] : []), ...(bounds.to ? [lte(wfsInventoryLogs.transactionTime, bounds.to)] : [])];
      const rows = await db.select({ id: wfsInventoryLogs.id, storeId: wfsInventoryLogs.storeId, sku: wfsInventoryLogs.sku, gtin: wfsInventoryLogs.gtin, fcId: wfsInventoryLogs.fcId, fcName: wfsInventoryLogs.fcName, changedUnits: wfsInventoryLogs.changedUnits, transactionTime: wfsInventoryLogs.transactionTime, transactionLocation: wfsInventoryLogs.transactionLocation, reasonCode: wfsInventoryLogs.reasonCode, reasonDescription: wfsInventoryLogs.reasonDescription, transactionType: wfsInventoryLogs.transactionType, shipmentId: wfsInventoryLogs.shipmentId, createdAt: wfsInventoryLogs.createdAt }).from(wfsInventoryLogs).where(and(...conditions)).orderBy(wfsInventoryLogs.transactionTime);
      return rows.map(row => ({ ...row, occurredAt: row.transactionTime?.toISOString() ?? row.createdAt.toISOString() }));
    }
    const catalog = new WfsShipmentRepository(pool);
    const candidates = await catalog.list(tenantId, storeId, bounds.from, bounds.to);
    const uniqueShipments = shipmentId ? candidates.filter((row:any)=>row.shipmentId===shipmentId) : candidates;
    const summary=view==='summary';
    const shipmentIds = [...new Set(uniqueShipments.map((shipment: any) => String(shipment.shipmentId ?? '').trim()).filter(Boolean))];
    const shipmentNumbers = [...new Set(uniqueShipments.map((shipment: any) => String(shipment.shipmentId ?? shipment.inboundOrderId ?? '').trim()).filter(Boolean))];
    if (!shipmentNumbers.length) return uniqueShipments.map((shipment: any) => ({ ...shipment, items: [] }));
    const matchingShipmentIds = shipmentIds.length ? shipmentIds : shipmentNumbers;
    const feesPromise = summary ? Promise.resolve([[],[],[]] as any) : Promise.all([
      db.select({ id: wfsFeePreviewRuns.id, tenantId: wfsFeePreviewRuns.tenantId, storeId: wfsFeePreviewRuns.storeId, shipmentId: wfsFeePreviewRuns.shipmentId, status: wfsFeePreviewRuns.status, lastAttemptAt: wfsFeePreviewRuns.lastAttemptAt, lastSuccessAt: wfsFeePreviewRuns.lastSuccessAt }).from(wfsFeePreviewRuns).where(and(eq(wfsFeePreviewRuns.tenantId, tenantId), inArray(wfsFeePreviewRuns.shipmentId, shipmentNumbers), ...(storeId ? [eq(wfsFeePreviewRuns.storeId, storeId)] : []))),
      db.select({ id: wfsFeePreviewOptions.id, runId: wfsFeePreviewOptions.runId, tenantId: wfsFeePreviewOptions.tenantId, storeId: wfsFeePreviewOptions.storeId, shipmentId: wfsFeePreviewOptions.shipmentId, previewType: wfsFeePreviewOptions.previewType, shipNode: wfsFeePreviewOptions.shipNode, destinationName: wfsFeePreviewOptions.destinationName, totalNetTransferCharge: wfsFeePreviewOptions.totalNetTransferCharge, currency: wfsFeePreviewOptions.currency }).from(wfsFeePreviewOptions).where(and(eq(wfsFeePreviewOptions.tenantId, tenantId), inArray(wfsFeePreviewOptions.shipmentId, shipmentNumbers), ...(storeId ? [eq(wfsFeePreviewOptions.storeId, storeId)] : []))),
      db.select({ optionId: wfsFeePreviewItems.optionId, tenantId: wfsFeePreviewItems.tenantId, storeId: wfsFeePreviewItems.storeId, shipmentId: wfsFeePreviewItems.shipmentId, gtin: wfsFeePreviewItems.gtin, sku: wfsFeePreviewItems.sku, itemQuantity: wfsFeePreviewItems.itemQuantity, netTransferCharge: wfsFeePreviewItems.netTransferCharge, unitTransferCharge: wfsFeePreviewItems.unitTransferCharge, currency: wfsFeePreviewItems.currency }).from(wfsFeePreviewItems).where(and(eq(wfsFeePreviewItems.tenantId, tenantId), inArray(wfsFeePreviewItems.shipmentId, shipmentNumbers), ...(storeId ? [eq(wfsFeePreviewItems.storeId, storeId)] : []))),
    ]);
    const productsPromise = summary ? Promise.resolve([] as any[]) : db.select({storeId:skus.storeId,sku:skus.externalId,title:skus.title,imageUrl:skus.imageUrl}).from(skus).where(and(eq(skus.tenantId,tenantId),...(storeId?[eq(skus.storeId,storeId)]:[])));
    const [itemRows, headFreight, inventoryLogs, [feeRuns, feeOptions, feeItems], productRows] = await Promise.all([
      catalog.items(tenantId, storeId),
      db.select({ storeId: headFreightRows.storeId, shipmentNumber: headFreightRows.wfsShipmentNumber, sku: headFreightRows.sku, quantity: headFreightRows.quantity, inboundNumber: headFreightRows.freightForwarderInboundNumber }).from(headFreightRows).where(and(eq(headFreightRows.tenantId, tenantId), inArray(headFreightRows.wfsShipmentNumber, shipmentNumbers), ...(storeId ? [eq(headFreightRows.storeId, storeId)] : []))),
      shipmentReceiptTotals(pool, tenantId, matchingShipmentIds, storeId),
      feesPromise,
      productsPromise,
    ]);
    const normalizeTrackingKey = (value: unknown) => String(value ?? '').trim().toUpperCase();
    const shipmentKeys = new Map<string, Set<string>>();
    for (const shipment of uniqueShipments) {
      const key = String(shipment.storeId ?? '');
      const values = shipmentKeys.get(key) ?? new Set<string>();
      values.add(normalizeTrackingKey(shipment.shipmentId ?? shipment.inboundOrderId));
      if (shipment.inboundOrderId) values.add(normalizeTrackingKey(shipment.inboundOrderId));
      shipmentKeys.set(key, values);
    }
    const itemsByShipment = groupWfsShipmentItems(filterWfsShipmentItemRows(itemRows, shipmentKeys));

    const inboundNumbers = [...new Set(headFreight.map((row) => row.inboundNumber).filter((value): value is string => Boolean(value)))];
    const trackingSource = headFreight;
    const trackingRoutes = !summary && inboundNumbers.length ? await db.select({ inboundNumber: freightTrackingRoutes.freightForwarderInboundNumber, brand: freightTrackingRoutes.brand, currentStatus: freightTrackingRoutes.currentStatus, currentStatusText: freightTrackingRoutes.currentStatusText, lastEventAt: freightTrackingRoutes.lastEventAt, routeId: freightTrackingRoutes.id }).from(freightTrackingRoutes).where(and(eq(freightTrackingRoutes.tenantId, tenantId), inArray(freightTrackingRoutes.freightForwarderInboundNumber, inboundNumbers))) : [];
    const trackingRouteIds = trackingRoutes.map((route) => route.routeId);
    const trackingEvents = trackingRouteIds.length ? await db.select({ routeId: freightTrackingEvents.routeId, eventTimeText: freightTrackingEvents.eventTimeText, eventAt: freightTrackingEvents.eventAt, info: freightTrackingEvents.info, eventCode: freightTrackingEvents.eventCode, routeOrder: freightTrackingEvents.routeOrder, raw: freightTrackingEvents.raw }).from(freightTrackingEvents).where(and(eq(freightTrackingEvents.tenantId, tenantId), inArray(freightTrackingEvents.routeId, trackingRouteIds))) : [];
    const eventsByRoute = new Map<string, WfsTrackingEvent[]>();
    for (const event of trackingEvents) {
      const events = eventsByRoute.get(event.routeId) ?? [];
      const raw = event.raw as Record<string, unknown>;
      const value = raw.isCompleted ?? raw.isMake;
      const isCompleted = typeof value === 'boolean' ? value : value === 1 || value === '1' ? true : value === 0 || value === '0' ? false : null;
      const { raw: _raw, ...eventFields } = event;
      events.push({ ...eventFields, info: isCompleted === false ? `预计 · ${eventFields.info}` : eventFields.info, isCompleted });
      eventsByRoute.set(event.routeId, events);
    }
    for (const events of eventsByRoute.values()) events.sort((a, b) => (b.eventAt?.getTime() ?? b.routeOrder) - (a.eventAt?.getTime() ?? a.routeOrder));
    const routeByInbound = new Map(trackingRoutes.map((route) => [normalizeTrackingKey(route.inboundNumber), route]));
    const trackingByShipment = new Map<string, WfsTracking>();
    for (const source of trackingSource) {
      const shipmentKey = normalizeTrackingKey(source.shipmentNumber);
      const inboundKey = normalizeTrackingKey(source.inboundNumber);
      const route = routeByInbound.get(inboundKey);
      if (!shipmentKey || !route || trackingByShipment.has(shipmentKey)) continue;
      trackingByShipment.set(shipmentKey, { inboundNumber: route.inboundNumber, brand: route.brand, currentStatus: route.currentStatus, currentStatusText: route.currentStatusText, lastEventAt: route.lastEventAt, events: eventsByRoute.get(route.routeId) ?? [] });
    }

    const products = new Map(productRows.map(row=>[`${row.storeId}:${normalizeTrackingKey(row.sku)}`,row]));
    const { shippedByKey, receivedByKey } = aggregateWfsActualQuantities(headFreight, inventoryLogs);
    const shipmentRows = uniqueShipments.map((shipment: any) => {
      const shipmentItems = itemsByShipment.get(`${shipment.storeId}:${normalizeTrackingKey(shipment.shipmentId ?? shipment.inboundOrderId)}`) ?? [];
      const enrichedItems = shipmentItems.map((item: any) => {
        const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
        const key = `${String(shipment.storeId ?? '').trim()}:${normalize(shipment.shipmentId ?? shipment.inboundOrderId)}:${normalize(item.sku ?? item.item?.sku ?? item.itemId)}`;
        const shippedQty = shippedByKey.get(key);
        const receipt = resolveWfsReceipt(shippedQty, receivedByKey.get(key));
        const product = products.get(`${shipment.storeId}:${normalize(item.sku)}`);
        return { ...item, itemDesc:item.itemDesc ?? item.productName ?? product?.title, imageUrl:product?.imageUrl ?? undefined, ...receipt };
      });
      const actualShippedUnits = enrichedItems.reduce((sum: number, item: any) => sum + Number(item.actualShippedQty ?? 0), 0);
      const actualReceivedUnits = enrichedItems.reduce((sum: number, item: any) => sum + Number(item.actualReceivedQty ?? 0), 0);
      const hasActualShipped = enrichedItems.some((item: any) => item.actualShippedQty != null);
      const hasActualReceived = enrichedItems.some((item: any) => item.actualReceivedQty != null);
      const tracking = trackingByShipment.get(normalizeTrackingKey(shipment.shipmentId));
      return { ...shipment, items: enrichedItems, actualShippedUnits: hasActualShipped ? actualShippedUnits : undefined, actualReceivedUnits: hasActualReceived ? actualReceivedUnits : undefined, fullyReceived: hasActualShipped && hasActualReceived ? actualReceivedUnits >= actualShippedUnits : undefined, tracking };
    });
    const shipmentsWithHeadFreight = attachWfsHeadFreight(shipmentRows, headFreight);
    if(summary)return shipmentsWithHeadFreight.map(({tracking,headFreightItems,...row}:any)=>({...row,headFreightItems,items:row.items.map((item:any)=>({sku:item.sku,itemQty:item.itemQty,receivedQty:item.receivedQty,actualShippedQty:item.actualShippedQty,actualReceivedQty:item.actualReceivedQty}))}));
    return attachWfsFeePreviews(shipmentsWithHeadFreight, { tenantId, runs: feeRuns, options: feeOptions, items: feeItems });
  };
  return async (kind:'shipments'|'reconciliations' = 'shipments', tenantId = '', storeId?: string, from?: string, to?: string, view?:string, shipmentId?:string):Promise<WfsHistoryRow[]> => {
    const key = [kind, tenantId, storeId ?? '', from ?? '', to ?? '',view??'',shipmentId??''].join('|');
    const now = Date.now();
    const cached = cache.get(key);
    if (cached?.value && cached.expiresAt > now) return cached.value;
    if (cached?.value && cached.staleUntil && cached.staleUntil > now) {
      if(!cached.pending){const refresh=load(kind,tenantId,storeId,from,to,view,shipmentId).then(value=>{cache.set(key,{value,expiresAt:Date.now()+30_000,staleUntil:Date.now()+120_000});return value;}).catch(()=>cached.value!).finally(()=>{const current=cache.get(key);if(current===cached)cached.pending=undefined;});cached.pending=refresh;}
      return cached.value;
    }
    if (cached?.pending) return cached.pending;
    const pending = load(kind, tenantId, storeId, from, to,view,shipmentId).then((value) => { if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key, { value, expiresAt: Date.now() + (kind === 'shipments' ? 30_000 : 5_000),staleUntil:kind==='shipments'?Date.now()+120_000:undefined }); return value; }).finally(() => {
      const current = cache.get(key);
      if (current?.pending) cache.set(key, { expiresAt: current.expiresAt, value: current.value });
    });
    cache.set(key, { expiresAt: 0, pending });
    return pending;
  };
}

export function mysqlWfsReceiptSource() {
  const { db } = createDb();
  return async (tenantId: string, storeId: string, shipmentId: string): Promise<WfsReceiptLog[]> => db.select({
    id: wfsInventoryLogs.id, storeId: wfsInventoryLogs.storeId, shipmentId: wfsInventoryLogs.shipmentId, sku: wfsInventoryLogs.sku, gtin: wfsInventoryLogs.gtin, changedUnits: wfsInventoryLogs.changedUnits, fcId: wfsInventoryLogs.fcId, fcName: wfsInventoryLogs.fcName, transactionTime: wfsInventoryLogs.transactionTime, transactionLocation: wfsInventoryLogs.transactionLocation, reasonCode: wfsInventoryLogs.reasonCode, reasonDescription: wfsInventoryLogs.reasonDescription, transactionType: wfsInventoryLogs.transactionType,
  }).from(wfsInventoryLogs).where(and(
    eq(wfsInventoryLogs.tenantId, tenantId),
    eq(wfsInventoryLogs.storeId, storeId),
    eq(wfsInventoryLogs.shipmentId, shipmentId),
  ));
}
