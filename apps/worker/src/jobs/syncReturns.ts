import { randomUUID } from 'node:crypto';
import { walmartGet, type WalmartConnection } from '@walmart-erp/walmart-client';
export interface NormalizedReturn { id: string; tenantId: string; storeId: string; orderId: string; sku: string; amount: number; status: string; returnedAt: string; rawResponseId: string; }
export interface ReturnStatusSnapshot { id: string; returnId: string; status: string; refundAmount: number; returnedAt: string; rawResponseId: string; }
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function normalizeReturnPayload(payload: unknown, context: { tenantId: string; storeId: string; rawResponseId: string }): NormalizedReturn[] {
  const body = object(payload);
  return array(body.returns ?? body.returnOrders ?? body.data).flatMap((value) => {
    const row = object(value);
    const returnId = String(row.returnOrderId ?? row.returnId ?? row.id ?? '');
    return array(row.returnOrderLines ?? row.lines).flatMap((lineValue, index) => {
      const line = object(lineValue);
      const sku = String(object(line.item).sku ?? line.sku ?? '');
      if (!returnId || !sku) return [];
      const orderNumber = String(row.purchaseOrderId ?? row.customerOrderId ?? '');
      return [{ id: `${context.storeId}:${returnId}:${String(line.lineNumber ?? index + 1)}`, tenantId: context.tenantId, storeId: context.storeId, orderId: orderNumber ? `${context.storeId}:${orderNumber}` : '', sku, amount: Number(object(line.refundAmount).amount ?? line.refundAmount ?? 0) || 0, status: String(line.status ?? row.status ?? ''), returnedAt: String(row.returnDate ?? row.returnedAt ?? ''), rawResponseId: context.rawResponseId }];
    });
  });
}
export interface ReturnWindow { tenantId: string; storeId: string; from: string; to: string; overlapMs?: number; }
export interface ReturnPage { returns?: unknown[]; returnOrders?: unknown[]; data?: unknown[]; nextCursor?: string; }
export async function replayReturnPages(window: ReturnWindow, fetchPage: (query: Record<string, string>) => Promise<ReturnPage>, persistRaw?: (payload: ReturnPage, id: string) => Promise<void>, upsert?: (row: NormalizedReturn) => Promise<void>): Promise<NormalizedReturn[]> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  const rows = new Map<string, NormalizedReturn>();
  do {
    const query = { lastModifiedStartDate: new Date(new Date(window.from).getTime() - (window.overlapMs ?? 0)).toISOString(), lastModifiedEndDate: window.to, ...(cursor ? { nextCursor: cursor } : {}) };
    const payload = await fetchPage(query);
    const rawResponseId = randomUUID();
    await persistRaw?.(payload, rawResponseId);
    for (const row of normalizeReturnPayload(payload, { tenantId: window.tenantId, storeId: window.storeId, rawResponseId })) { if (rows.has(row.id)) continue; rows.set(row.id, row); await upsert?.(row); }
    cursor = payload.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Repeated Walmart return cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...rows.values()];
}
export async function syncReturns(window: ReturnWindow, connection: WalmartConnection, persistRaw: (payload: ReturnPage, id: string) => Promise<void>, upsert: (row: NormalizedReturn) => Promise<void>, appendSnapshot?: (snapshot: ReturnStatusSnapshot) => Promise<void>): Promise<number> {
  const rows = await replayReturnPages(window, async (query) => (await walmartGet<ReturnPage>(connection, '/v3/returns', { query })).data, persistRaw, async (row) => {
    await upsert(row);
    await appendSnapshot?.(Object.freeze({ id: `${row.id}:${row.status}:${row.amount}:${row.returnedAt}`, returnId: row.id, status: row.status, refundAmount: row.amount, returnedAt: row.returnedAt, rawResponseId: row.rawResponseId }));
  });
  return rows.length;
}
