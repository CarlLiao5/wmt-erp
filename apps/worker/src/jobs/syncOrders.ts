import { randomUUID } from 'node:crypto';
import { walmartGet, type WalmartConnection } from '@walmart-erp/walmart-client';

export interface NormalizedOrderLine {
  id: string; tenantId: string; storeId: string; orderId: string; orderNumber: string; sku: string; itemId?: string; quantity?: number; amount?: number; orderedAt?: string; status: string; rawResponseId: string;
  customerOrderId?: string; customerEmail?: string; estimatedDeliveryAt?: string; postalCode?: string; city?: string; state?: string; country?: string;
  fulfillmentOption?: string; shipMethod?: string; isWfs?: boolean; orderTotalAmount?: number; currency?: string;
  lineNumber: string; upc?: string; productName?: string; unitPrice?: number; shippingCharge?: number; itemStatus: string;
  region?: string; customer?: Record<string, string>;
}
export interface OrderContext { tenantId: string; storeId: string; rawResponseId: string; }
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => value == null ? '' : String(value);
const walmartDateTime = (value: Date | string): string => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
const optionalText = (value: unknown): string | undefined => value == null || String(value).trim() === '' ? undefined : String(value).trim();
const optionalAmount = (value: unknown): number | undefined => value == null || value === '' ? undefined : Number.isFinite(Number(object(value).amount ?? value)) ? Number(object(value).amount ?? value) : undefined;
const amount = (value: unknown): number => optionalAmount(value) ?? 0;
function orderDate(value: unknown): string | undefined { if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString(); const raw = optionalText(value); return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : undefined; }
function chargeRows(line: Row): Row[] { return array(object(line.charges).charge).map(object); }
function chargeTotal(charges: Row[], types: string[]): number | undefined { const matched = charges.filter((entry) => types.includes(String(entry.chargeType ?? '').toUpperCase())); if (!matched.length) return undefined; const values = matched.map((entry) => optionalAmount(entry.chargeAmount)); return values.some((value) => value == null) ? undefined : values.reduce<number>((total, value) => total + value!, 0); }
function orderLineFallbackTotal(line: Row): number | undefined {
  const charges = chargeRows(line);
  const product = chargeTotal(charges, ['PRODUCT']);
  const shipping = chargeTotal(charges, ['SHIPPING', 'SHIPPING_CHARGE']);
  const tax = charges.reduce((sum, charge) => sum + (optionalAmount(charge.taxAmount) ?? optionalAmount(object(charge.tax).taxAmount) ?? 0), 0);
  const total = (product ?? 0) + (shipping ?? 0) + tax;
  return product == null && shipping == null && tax === 0 ? undefined : total;
}

export function normalizeOrderPayload(payload: unknown, context: OrderContext): NormalizedOrderLine[] {
  const body = object(payload);
  const elements = object(object(body.list).elements);
  const orders = array(elements.order ?? (Object.keys(elements).length ? elements : undefined) ?? body.orders ?? body.data ?? body.items);
  return orders.flatMap((value) => {
    const order = object(value);
    const orderNumber = text(order.purchaseOrderId ?? order.customerOrderId ?? order.orderId);
    if (!orderNumber) return [];
    const lines = array(object(order.orderLines).orderLine ?? order.orderLines);
    const address = object(object(order.shippingInfo).postalAddress);
    const shippingInfo = object(order.shippingInfo);
    const customerSource = Object.keys(object(order.customer)).length ? object(order.customer) : address;
    const customer = Object.fromEntries(Object.entries(customerSource).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
    const normalized = lines.flatMap((lineValue, index) => {
      const line = object(lineValue);
      const item = object(line.item);
      const sku = text(item.sku ?? line.sku).trim();
      if (!sku) return [];
      const lineNumber = text(line.lineNumber ?? index + 1);
      const charges = chargeRows(line);
      const productAmount = chargeTotal(charges, ['PRODUCT']);
      const shippingCharge = chargeTotal(charges, ['SHIPPING', 'SHIPPING_CHARGE']);
      const quantity = optionalAmount(line.orderLineQuantity);
      const unitPrice = optionalAmount(line.unitPrice);
      const lineAmount = productAmount ?? optionalAmount(line.amount) ?? (unitPrice == null || quantity == null ? undefined : unitPrice * quantity);
      const itemStatus = text(object(array(object(line.orderLineStatuses).orderLineStatus)[0]).status ?? line.status);
      const fulfillment = object(line.fulfillment);
      const shipNode = text(line.shipNodeType ?? order.shipNodeType ?? object(order.shipNode).type).toUpperCase();
      const fulfillmentOption = optionalText(line.fulfillmentOption ?? fulfillment.fulfillmentOption ?? order.fulfillmentOption);
      const fulfillmentSignal = `${shipNode} ${fulfillmentOption ?? ''} ${text(fulfillment.shippingProgramType)}`.trim();
      const currency = optionalText(object(charges.find((entry) => String(entry.chargeType).toUpperCase() === 'PRODUCT')?.chargeAmount).currency ?? object(line.unitPrice).currency ?? order.currency ?? object(order.orderTotal).currency);
      return [{
        id: `${context.storeId}:${orderNumber}:${lineNumber}`, tenantId: context.tenantId, storeId: context.storeId, orderId: `${context.storeId}:${orderNumber}`, orderNumber, sku,
        itemId: optionalText(item.productId ?? line.productId), quantity, amount: lineAmount, orderedAt: orderDate(order.orderDate ?? order.orderedAt),
        status: text(order.status ?? itemStatus), orderTotalAmount: optionalAmount(order.orderTotal ?? order.totalAmount), currency,
        lineNumber, upc: optionalText(item.upc ?? line.upc ?? line.gtin), productName: optionalText(item.productName ?? line.productName), unitPrice, shippingCharge,
        itemStatus, customerOrderId: optionalText(order.customerOrderId), customerEmail: optionalText(order.customerEmail ?? order.customerEmailId ?? shippingInfo.email ?? object(order.customer).email),
        estimatedDeliveryAt: orderDate(order.estimatedDeliveryDate ?? order.estimatedDeliveryAt) || undefined,
        postalCode: optionalText(address.postalCode), city: optionalText(address.city), state: optionalText(address.state), country: optionalText(address.country),
        fulfillmentOption, shipMethod: optionalText(line.shipMethod ?? fulfillment.shipMethod ?? order.shipMethod), isWfs: fulfillmentSignal ? /WFS/i.test(fulfillmentSignal) : undefined,
        rawResponseId: context.rawResponseId, region: optionalText(address.state), ...(Object.keys(customer).length ? { customer } : {}),
      }];
    });
    const orderTotal = optionalAmount(order.orderTotal ?? order.totalAmount) ?? lines.reduce<number | undefined>((total, lineValue) => {
      const fallback = orderLineFallbackTotal(object(lineValue));
      return fallback == null ? total : (total ?? 0) + fallback;
    }, undefined);
    return normalized.map((line) => ({ ...line, ...(orderTotal == null ? {} : { orderTotalAmount: orderTotal }) }));
  });
}

export interface OrderPage { orders?: unknown[]; list?: { elements?: unknown[] | { order?: unknown[] }; meta?: { nextCursor?: string | null } }; data?: unknown[]; nextCursor?: string; }
export interface ReplayWindow { tenantId: string; storeId: string; from: string; to: string; overlapMs?: number; }
function cursorQuery(cursor: string): Record<string, string> {
  const params = Object.fromEntries(new URLSearchParams(cursor.replace(/^\?/, '')).entries());
  if (Object.keys(params).length === 0) throw new Error('Walmart returned an invalid order nextCursor');
  return params;
}
export async function replayOrderPages(window: ReplayWindow, fetchPage: (query: Record<string, string>) => Promise<OrderPage>, persistRaw?: (payload: OrderPage, rawResponseId: string) => Promise<void>, upsert?: (line: NormalizedOrderLine) => Promise<void>): Promise<NormalizedOrderLine[]> {
  const rows = new Map<string, NormalizedOrderLine>();
  const seenCursors = new Set<string>();
  const start = walmartDateTime(new Date(new Date(window.from).getTime() - (window.overlapMs ?? 0)));
  const end = walmartDateTime(window.to);
  let cursor: string | undefined;
  const seen = new Set<string>();
  const seenPages = new Set<string>();
  do {
    const page = await fetchPage({ createdStartDate: start, createdEndDate: end, ...(cursor ? cursorQuery(cursor) : {}) });
    const lines = normalizeOrderPayload(page, { tenantId: window.tenantId, storeId: window.storeId, rawResponseId: '' });
    const nextCursor = page.nextCursor ?? page.list?.meta?.nextCursor ?? undefined;
    const pageSignature = lines.map((line) => line.id).sort().join('\n');
    if (nextCursor && pageSignature && seenPages.has(pageSignature)) {
      throw new Error('Walmart returned the same order page with a new cursor; stopped pagination to prevent an endless sync');
    }
    if (pageSignature) seenPages.add(pageSignature);
    const rawResponseId = randomUUID();
    await persistRaw?.(page, rawResponseId);
    for (const line of lines) { if (rows.has(line.id)) continue; const normalized = { ...line, rawResponseId }; rows.set(normalized.id, normalized); await upsert?.(normalized); }
    cursor = nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Repeated Walmart order cursor; refusing to report a partial sync as successful');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...rows.values()];
}

export async function syncOrders(window: ReplayWindow, connection: WalmartConnection, persistRaw: (payload: OrderPage, rawResponseId: string) => Promise<void>, upsert: (line: NormalizedOrderLine) => Promise<void>): Promise<NormalizedOrderLine[]> {
  const rows = new Map<string, NormalizedOrderLine>();
  for (const shipNodeType of ['SellerFulfilled', 'WFSFulfilled']) {
    const pageRows = await replayOrderPages(window, async (query) => (await walmartGet<OrderPage>(connection, '/v3/orders', { query: { ...query, shipNodeType } })).data, persistRaw, async (line) => {
      if (rows.has(line.id)) return;
      rows.set(line.id, line);
      await upsert(line);
    });
    for (const line of pageRows) if (!rows.has(line.id)) rows.set(line.id, line);
  }
  return [...rows.values()];
}
