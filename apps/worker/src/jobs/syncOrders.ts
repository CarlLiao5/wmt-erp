import { randomUUID } from 'node:crypto';
import { walmartGet, type WalmartConnection } from '@walmart-erp/walmart-client';

export interface NormalizedOrderLine { id: string; tenantId: string; storeId: string; orderId: string; orderNumber: string; sku: string; itemId?: string; quantity: number; amount: number; orderedAt: string; status: string; rawResponseId: string; customer?: Record<string, string>; }
export interface OrderContext { tenantId: string; storeId: string; rawResponseId: string; }
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => value == null ? '' : String(value);
const amount = (value: unknown): number => Number(object(value).amount ?? value ?? 0) || 0;

export function normalizeOrderPayload(payload: unknown, context: OrderContext): NormalizedOrderLine[] {
  const body = object(payload);
  const orders = array(object(body.list).elements ?? body.orders ?? body.data ?? body.items);
  return orders.flatMap((value) => {
    const order = object(value);
    const orderNumber = text(order.purchaseOrderId ?? order.customerOrderId ?? order.orderId);
    if (!orderNumber) return [];
    const lines = array(object(order.orderLines).orderLine ?? order.orderLines);
    return lines.flatMap((lineValue, index) => {
      const line = object(lineValue);
      const sku = text(object(line.item).sku ?? line.sku).trim();
      if (!sku) return [];
      const lineNumber = text(line.lineNumber ?? index + 1);
      const charges = array(object(line.charges).charge).map(object).filter((entry) => entry.chargeType === 'PRODUCT');
      const customer = Object.fromEntries(Object.entries(object(order.customer)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      const status = object(array(object(line.orderLineStatuses).orderLineStatus)[0]).status;
      return [{ id: `${context.storeId}:${orderNumber}:${lineNumber}`, tenantId: context.tenantId, storeId: context.storeId, orderId: `${context.storeId}:${orderNumber}`, orderNumber, sku, itemId: text(object(line.item).productId) || undefined, quantity: amount(line.orderLineQuantity), amount: charges.length ? charges.reduce((total, charge) => total + amount(charge.chargeAmount), 0) : amount(line.amount), orderedAt: text(order.orderDate ?? order.orderedAt), status: text(status ?? line.status ?? order.status), rawResponseId: context.rawResponseId, ...(Object.keys(customer).length ? { customer } : {}) }];
    });
  });
}

export interface OrderPage { orders?: unknown[]; list?: { elements?: unknown[] }; data?: unknown[]; nextCursor?: string; }
export interface ReplayWindow { tenantId: string; storeId: string; from: string; to: string; overlapMs?: number; }
export async function replayOrderPages(window: ReplayWindow, fetchPage: (query: Record<string, string>) => Promise<OrderPage>, persistRaw?: (payload: OrderPage, rawResponseId: string) => Promise<void>, upsert?: (line: NormalizedOrderLine) => Promise<void>): Promise<NormalizedOrderLine[]> {
  const rows = new Map<string, NormalizedOrderLine>();
  const start = new Date(new Date(window.from).getTime() - (window.overlapMs ?? 0)).toISOString();
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await fetchPage({ lastModifiedStartDate: start, lastModifiedEndDate: window.to, ...(cursor ? { nextCursor: cursor } : {}) });
    const rawResponseId = randomUUID();
    await persistRaw?.(page, rawResponseId);
    for (const line of normalizeOrderPayload(page, { tenantId: window.tenantId, storeId: window.storeId, rawResponseId })) { if (rows.has(line.id)) continue; rows.set(line.id, line); await upsert?.(line); }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Repeated Walmart order cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...rows.values()];
}

export async function syncOrders(window: ReplayWindow, connection: WalmartConnection, persistRaw: (payload: OrderPage, rawResponseId: string) => Promise<void>, upsert: (line: NormalizedOrderLine) => Promise<void>): Promise<NormalizedOrderLine[]> {
  return replayOrderPages(window, async (query) => (await walmartGet<OrderPage>(connection, '/v3/orders', { query })).data, persistRaw, upsert);
}
