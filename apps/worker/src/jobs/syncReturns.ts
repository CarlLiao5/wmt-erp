import { randomUUID } from 'node:crypto';
import { walmartGet, type WalmartConnection } from '@walmart-erp/walmart-client';
export interface NormalizedReturn { id: string; tenantId: string; storeId: string; orderId: string; orderNumber?: string; returnOrderId: string; customerOrderId?: string; returnOrderItemId?: string; itemId?: string; sku?: string; productName?: string; quantity?: number; amount?: number; currency?: string; status?: string; reason?: string; reasonCode?: string; returnedAt?: string; returnInitiatedAt?: string; refundIssuedAt?: string; isWfs?: boolean; returnMethod?: string; deliveryStatus?: string; channelName?: string; refundStatus?: string; refundCoveredBy?: string; refundChannelCoveredBy?: string; isReturnForException?: boolean; returnChannelName?: string; createdAt?: string; updatedAt?: string; rawResponseId: string; }
export interface ReturnStatusSnapshot { id: string; returnId: string; status: string; refundAmount?: number; returnedAt?: string; rawResponseId: string; }
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const optionalText = (value: unknown): string | undefined => value == null || String(value).trim() === '' ? undefined : String(value).trim();
const optionalNumber = (value: unknown): number | undefined => { const source = object(value); const raw = source.measurementValue ?? source.amount ?? source.currencyAmount ?? source.value ?? value; return raw == null || raw === '' || !Number.isFinite(Number(raw)) ? undefined : Number(raw); };
function dateText(value: unknown): string | undefined { if (value == null || value === '') return undefined; const date = new Date(value as string | number); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); }
export function normalizeReturnPayload(payload: unknown, context: { tenantId: string; storeId: string; rawResponseId: string }): NormalizedReturn[] {
  const body = object(payload);
  return array(body.returns ?? body.returnOrders ?? body.data).flatMap((value) => {
    const row = object(value);
    const returnId = String(row.returnOrderId ?? row.returnId ?? row.id ?? '');
    const returnLines = array(row.returnOrderLines ?? row.lines);
    return returnLines.flatMap((lineValue, index) => {
      const line = object(lineValue);
      const item = object(line.item);
      if (!returnId) return [];
      const sku = optionalText(item.sku ?? line.sku);
      const orderNumber = String(line.purchaseOrderId ?? row.purchaseOrderId ?? row.customerOrderId ?? '');
      const refundAmount = object(line.refundAmount);
      const explicitRefund = line.totalRefundAmount ?? line.refundAmount ?? line.refundedAmount ?? (returnLines.length === 1 ? row.totalRefundAmount : undefined);
      const amount = optionalNumber(explicitRefund);
      const returnReason = line.returnReason ?? row.returnReason;
      const reasonObject = object(returnReason);
      const reasonDescription = line.returnDescription ?? line.returnReasonDescription ?? row.returnDescription ?? row.returnReasonDescription;
      const reason = optionalText(reasonObject.description ?? reasonObject.name ?? reasonDescription ?? reasonObject.code ?? returnReason ?? line.returnReasonCode ?? line.reasonCode ?? line.reason ?? row.returnReasonCode ?? row.reasonCode ?? row.reason);
      const returnInitiatedAt = dateText(row.returnInitiatedDate ?? row.returnInitiatedAt ?? object(array(line.returnTrackingDetail).find((e) => object(e).eventTag === 'RETURN_INITIATED')).eventTime ?? row.returnOrderDate ?? row.returnDate ?? row.returnedAt);
      const refundIssuedAt = dateText(row.refundIssuedDate ?? row.refundIssuedAt ?? object(array(line.returnTrackingDetail).find((e) => ['REFUND_ISSUED', 'REFUND_INITIATED'].includes(String(object(e).eventTag)))).eventTime);
      const wfsValue = line.isWfs ?? row.isWfs;
      const isWfs = wfsValue == null ? undefined : wfsValue === true || wfsValue === 1 || String(wfsValue).toLowerCase() === 'true';
      const reasonCode = optionalText(reasonObject.code ?? line.returnReasonCode ?? row.returnReasonCode ?? line.reasonCode ?? row.reasonCode ?? (typeof returnReason === 'string' ? returnReason : undefined));
      const refundChannels = array(line.refundChannels ?? row.refundChannels);
      const refundChannelCoveredBy = optionalText(refundChannels.map((value) => object(value).refundCoveredBy).find((value) => value != null));
      const refundCoveredBy = optionalText(line.refundCoveredBy ?? row.refundCoveredBy ?? refundChannelCoveredBy);
      const exceptionValue = line.isReturnForException ?? row.isReturnForException;
      const isReturnForException = exceptionValue == null ? undefined : exceptionValue === true || exceptionValue === 1 || String(exceptionValue).toLowerCase() === 'true';
      const returnChannelName = optionalText(object(row.returnChannel).channelName ?? line.returnChannelName ?? row.returnChannelName ?? row.channelName ?? row.channel);
      const returnedAt = dateText(line.statusTime ?? row.returnOrderDate ?? row.returnDate ?? row.returnedAt ?? row.returnInitiatedDate ?? row.createdAt);
      return [{ id: `${context.storeId}:${returnId}:${String(line.returnOrderLineNumber ?? line.lineNumber ?? index + 1)}`, tenantId: context.tenantId, storeId: context.storeId, orderId: orderNumber ? `${context.storeId}:${orderNumber}` : `${context.storeId}:${returnId}`, ...(orderNumber ? { orderNumber } : {}), returnOrderId: returnId, customerOrderId: optionalText(line.customerOrderId ?? row.customerOrderId), returnOrderItemId: optionalText(line.returnOrderItemId ?? line.returnOrderLineNumber ?? line.lineNumber), itemId: optionalText(item.productId ?? line.itemId), sku, productName: optionalText(item.productName ?? line.productName), quantity: optionalNumber(line.quantity ?? line.returnQuantity), amount, currency: optionalText(object(explicitRefund).currency ?? object(explicitRefund).currencyUnit ?? row.currency), status: optionalText(line.status ?? line.currentRefundStatus ?? row.returnStatus ?? row.status), ...(reason ? { reason } : {}), reasonCode, returnedAt, returnInitiatedAt: returnInitiatedAt || undefined, refundIssuedAt: refundIssuedAt || undefined, isWfs, returnMethod: optionalText(line.returnMethod ?? row.returnMethod), deliveryStatus: optionalText(line.deliveryStatus ?? row.deliveryStatus), channelName: returnChannelName, refundStatus: optionalText(line.refundStatus ?? line.currentRefundStatus ?? row.refundStatus), refundCoveredBy, refundChannelCoveredBy, isReturnForException, returnChannelName, createdAt: dateText(row.createDate ?? row.createdAt), updatedAt: dateText(row.lastModifiedDate ?? row.updatedAt), rawResponseId: context.rawResponseId }];
    });
  });
}
export interface ReturnWindow { tenantId: string; storeId: string; from: string; to: string; overlapMs?: number; }
export interface ReturnPage { returns?: unknown[]; returnOrders?: unknown[]; data?: unknown[]; meta?: { nextCursor?: string | null }; nextCursor?: string; }
function cursorQuery(cursor: string): Record<string, string> {
  const params = Object.fromEntries(new URLSearchParams(cursor.replace(/^\?/, '')).entries());
  if (Object.keys(params).length === 0) throw new Error('Walmart returned an invalid return nextCursor');
  return params;
}
export async function replayReturnPages(window: ReturnWindow, fetchPage: (query: Record<string, string>) => Promise<ReturnPage>, persistRaw?: (payload: ReturnPage, id: string) => Promise<void>, upsert?: (row: NormalizedReturn) => Promise<void>): Promise<NormalizedReturn[]> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  const rows = new Map<string, NormalizedReturn>();
  do {
    const query = { returnLastModifiedStartDate: new Date(new Date(window.from).getTime() - (window.overlapMs ?? 0)).toISOString(), returnLastModifiedEndDate: window.to, ...(cursor ? cursorQuery(cursor) : {}) };
    const payload = await fetchPage(query);
    const rawResponseId = randomUUID();
    await persistRaw?.(payload, rawResponseId);
    for (const row of normalizeReturnPayload(payload, { tenantId: window.tenantId, storeId: window.storeId, rawResponseId })) { if (rows.has(row.id)) continue; rows.set(row.id, row); await upsert?.(row); }
    cursor = payload.nextCursor ?? payload.meta?.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Repeated Walmart return cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...rows.values()];
}
export async function syncReturns(window: ReturnWindow, connection: WalmartConnection, persistRaw: (payload: ReturnPage, id: string) => Promise<void>, upsert: (row: NormalizedReturn) => Promise<void>, appendSnapshot?: (snapshot: ReturnStatusSnapshot) => Promise<void>): Promise<number> {
  const rows = await replayReturnPages(window, async (query) => (await walmartGet<ReturnPage>(connection, '/v3/returns', { query })).data, persistRaw, async (row) => {
    await upsert(row);
    if (row.status) await appendSnapshot?.(Object.freeze({ id: `${row.id}:${row.status}:${row.amount ?? ''}`, returnId: row.id, status: row.status, ...(row.amount == null ? {} : { refundAmount: row.amount }), ...(row.returnedAt ? { returnedAt: row.returnedAt } : {}), rawResponseId: row.rawResponseId }));
  });
  return rows.length;
}
