import {archiveOrderPage} from '../../../../packages/db/src/normalization/order-extensions.js';
import { and, createDb, eq, gte, inArray, lt, or, rawPayloads, orders, orderLines, skus, dailyFacts, returnRecords, returnStatusEvents, sql } from '../../../../packages/db/index.js';
import type { WalmartConnection } from '@walmart-erp/walmart-client';
import { createHash } from 'node:crypto';
import { syncOrders, type ReplayWindow } from './syncOrders.js';
import { syncReturns, type ReturnWindow } from './syncReturns.js';
import { dailyFactRows, dailySalesFacts, salesDateInPacificTime, type SalesLine } from '../aggregates.js';

export interface RawPageRecord { tenantId: string; storeId: string; resource: 'orders' | 'returns'; externalId: string; payload: unknown; httpStatus: number; correlationId: string; receivedAt: Date; }
export function createCommerceRawWriter(append: (row: RawPageRecord) => Promise<void>) {
  return async (scope: Pick<RawPageRecord, 'tenantId' | 'storeId' | 'resource'>, payload: unknown, rawResponseId: string) => {
    await append({ ...scope, externalId: rawResponseId, payload: structuredClone(payload), httpStatus: 200, correlationId: rawResponseId, receivedAt: new Date() });
  };
}

export function presentFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function stableSkuId(storeId: string, sku: string) {
  const composite = `${storeId}:${sku}`;
  return composite.length <= 36 ? composite : createHash('sha256').update(composite).digest('hex').slice(0, 36);
}

function optionalDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function createCommerceDatabaseWriter(db: ReturnType<typeof createDb>['db']) {
  const previousOrderDates = new Set<string>();
  const knownSkus = new Map<string, string>();
  const knownOrders = new Set<string>();
  const pendingOrderLines: Array<{ line: import('./syncOrders.js').NormalizedOrderLine; now: Date }> = [];
  const pendingReturnLines: Array<{ line: import('./syncReturns.js').NormalizedReturn; now: Date }> = [];
  const lineColumns: Record<string, string> = { quantity: 'quantity', lineAmount: 'line_amount', currency: 'currency', lineNumber: 'line_number', upc: 'upc', productId: 'product_id', productName: 'product_name', unitPrice: 'unit_price', shippingCharge: 'shipping_charge', itemStatus: 'item_status' };
  const orderColumns: Record<string, string> = { status: 'status', orderedAt: 'ordered_at', totalAmount: 'total_amount', currency: 'currency', customerOrderId: 'customer_order_id', customerEmail: 'customer_email', region: 'region', state: 'state', postalCode: 'postal_code', city: 'city', country: 'country', estimatedDeliveryAt: 'estimated_delivery_at', fulfillmentOption: 'fulfillment_option', shipMethod: 'ship_method', isWfs: 'is_wfs' };
  const skuColumns: Record<string, string> = { itemId: 'item_id' };
  async function flushOrderLines() {
    while (pendingOrderLines.length) {
      const chunk = pendingOrderLines.slice(0, 500);
      const firstLine = chunk[0].line;
      const skuValues = [...new Set(chunk.map(({ line }) => line.sku))];
      const missingSkuIds = skuValues.filter((sku) => !knownSkus.has(`${firstLine.tenantId}:${firstLine.storeId}:${sku}`));
      if (missingSkuIds.length) {
        const existingSkus = await db.select({ id: skus.id, externalId: skus.externalId }).from(skus).where(and(eq(skus.tenantId, firstLine.tenantId), eq(skus.storeId, firstLine.storeId), inArray(skus.externalId, missingSkuIds)));
        const existingSkuIds = new Map(existingSkus.map((row) => [row.externalId, row.id]));
        const skuRows = skuValues.flatMap((sku) => {
          const cacheKey = `${firstLine.tenantId}:${firstLine.storeId}:${sku}`;
          if (knownSkus.has(cacheKey)) return [];
          const id = existingSkuIds.get(sku) ?? stableSkuId(firstLine.storeId, sku);
          const itemId = chunk.find(({ line }) => line.sku === sku && line.itemId !== undefined)?.line.itemId;
          return [{ id, cacheKey, tenantId: firstLine.tenantId, storeId: firstLine.storeId, externalId: sku, itemId: itemId ?? null, createdAt: new Date(), updatedAt: new Date(), hasItemId: itemId !== undefined }];
        });
        const skuGroups = new Map<boolean, typeof skuRows>();
        for (const row of skuRows) {
          const group = skuGroups.get(row.hasItemId) ?? [];
          group.push(row);
          skuGroups.set(row.hasItemId, group);
        }
        for (const [hasItemId, group] of skuGroups) {
          const values = group.map(({ hasItemId: _hasItemId, cacheKey: _cacheKey, ...row }) => row);
          const set = hasItemId ? { itemId: sql.raw(`VALUES(\`${skuColumns.itemId}\`)`), updatedAt: new Date() } : { updatedAt: new Date() };
          await db.insert(skus).values(values as never).onDuplicateKeyUpdate({ set });
        }
        for (const row of skuRows) knownSkus.set(row.cacheKey, row.id);
      }

      const orderIds = [...new Set(chunk.map(({ line }) => line.orderId).filter((id) => !knownOrders.has(id)))];
      if (orderIds.length) {
        const existingOrders = await db.select({ id: orders.id, orderedAt: orders.orderedAt }).from(orders).where(and(eq(orders.tenantId, firstLine.tenantId), eq(orders.storeId, firstLine.storeId), inArray(orders.id, orderIds)));
        const existingOrderById = new Map(existingOrders.map((row) => [row.id, row]));
        const orderRowsById = new Map<string, { row: Record<string, unknown>; updateFields: string[] }>();
        for (const { line, now } of chunk) {
          if (!orderIds.includes(line.orderId) || orderRowsById.has(line.orderId)) continue;
          const existingOrder = existingOrderById.get(line.orderId);
          if (existingOrder?.orderedAt) previousOrderDates.add(salesDateInPacificTime(existingOrder.orderedAt.toISOString()));
          const orderedAt = optionalDate(line.orderedAt);
          const updates = presentFields({ status: line.status || undefined, orderedAt, totalAmount: line.orderTotalAmount == null ? undefined : String(line.orderTotalAmount), currency: line.currency, customerOrderId: line.customerOrderId, customerEmail: line.customerEmail, region: line.region, state: line.state, postalCode: line.postalCode, city: line.city, country: line.country, estimatedDeliveryAt: optionalDate(line.estimatedDeliveryAt), fulfillmentOption: line.fulfillmentOption, shipMethod: line.shipMethod, isWfs: line.isWfs == null ? undefined : line.isWfs ? 1 : 0 });
          orderRowsById.set(line.orderId, { row: { id: line.orderId, tenantId: line.tenantId, storeId: line.storeId, externalId: line.orderNumber, customerOrderId: line.customerOrderId ?? null, customerEmail: line.customerEmail ?? null, status: line.status || 'UNKNOWN', region: line.region ?? null, state: line.state ?? null, postalCode: line.postalCode ?? null, city: line.city ?? null, country: line.country ?? null, orderedAt: orderedAt ?? null, estimatedDeliveryAt: optionalDate(line.estimatedDeliveryAt) ?? null, totalAmount: line.orderTotalAmount == null ? null : String(line.orderTotalAmount), currency: line.currency ?? null, fulfillmentOption: line.fulfillmentOption ?? null, shipMethod: line.shipMethod ?? null, isWfs: line.isWfs == null ? null : line.isWfs ? 1 : 0, sourceApi: 'orders', updatedAt: now }, updateFields: Object.keys(updates) });
        }
        const orderGroups = new Map<string, typeof orderRowsById extends Map<string, infer V> ? V[] : never>();
        for (const item of orderRowsById.values()) {
          const key = item.updateFields.join(',');
          const group = orderGroups.get(key) ?? [];
          group.push(item);
          orderGroups.set(key, group);
        }
        for (const group of orderGroups.values()) {
          const fields = [...new Set(group[0].updateFields)];
          const set = Object.fromEntries(fields.map((field) => [field, sql.raw(`VALUES(\`${orderColumns[field]}\`)`)]));
          await db.insert(orders).values(group.map((item) => item.row) as never).onDuplicateKeyUpdate({ set: { sourceApi: 'orders', updatedAt: new Date(), ...set } });
        }
        for (const id of orderIds) knownOrders.add(id);
      }

      const skuIdByCode = new Map(skuValues.map((sku) => [sku, knownSkus.get(`${firstLine.tenantId}:${firstLine.storeId}:${sku}`)!]));
      const lineRows = chunk.map(({ line, now }) => {
        const optionalUpdates = presentFields({ quantity: line.quantity == null ? undefined : String(line.quantity), lineAmount: line.amount == null ? undefined : String(line.amount), currency: line.currency, lineNumber: line.lineNumber, upc: line.upc, productId: line.itemId, productName: line.productName, unitPrice: line.unitPrice == null ? undefined : String(line.unitPrice), shippingCharge: line.shippingCharge == null ? undefined : String(line.shippingCharge), itemStatus: line.itemStatus || undefined });
        return { row: { id: line.id, tenantId: line.tenantId, storeId: line.storeId, orderId: line.orderId, skuId: skuIdByCode.get(line.sku), lineNumber: line.lineNumber ?? null, upc: line.upc ?? null, productId: line.itemId ?? null, productName: line.productName ?? null, quantity: line.quantity == null ? null : String(line.quantity), unitPrice: line.unitPrice == null ? null : String(line.unitPrice), lineAmount: line.amount == null ? null : String(line.amount), shippingCharge: line.shippingCharge == null ? null : String(line.shippingCharge), currency: line.currency ?? null, itemStatus: line.itemStatus || null, createdAt: null, updatedAt: now }, updateFields: Object.keys(optionalUpdates) };
      });
      const groups = new Map<string, typeof lineRows>();
      for (const item of lineRows) {
        const key = item.updateFields.join(',');
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const fields = [...new Set(group[0].updateFields)];
        const set = Object.fromEntries(fields.map((field) => [field, sql.raw(`VALUES(\`${lineColumns[field]}\`)`)]));
        await db.insert(orderLines).values(group.map((item) => item.row) as never).onDuplicateKeyUpdate({ set: { ...set, updatedAt: new Date() } });
      }
      pendingOrderLines.splice(0, chunk.length);
    }
  }
  async function flushReturnLines() {
    while (pendingReturnLines.length) {
      const chunk = pendingReturnLines.splice(0, 100);
      const first = chunk[0].line;
      const existingRows = await db.select({ id: returnRecords.id, status: returnRecords.status, amount: returnRecords.amount }).from(returnRecords).where(and(eq(returnRecords.tenantId, first.tenantId), eq(returnRecords.storeId, first.storeId), inArray(returnRecords.id, chunk.map(({ line }) => line.id))));
      const existingById = new Map(existingRows.map((row) => [row.id, row]));
      const rows = chunk.map(({ line, now }) => {
        const existing = existingById.get(line.id);
        const amount = line.amount == null ? undefined : String(line.amount);
        const updates = presentFields({ status: line.status, amount, orderId: line.orderId || undefined, orderNumber: line.orderNumber, customerOrderId: line.customerOrderId, returnOrderId: line.returnOrderId, returnOrderItemId: line.returnOrderItemId, itemId: line.itemId, sku: line.sku, productName: line.productName, quantity: line.quantity, currency: line.currency, reason: line.reason, reasonCode: line.reasonCode, returnInitiatedAt: optionalDate(line.returnInitiatedAt), refundIssuedAt: optionalDate(line.refundIssuedAt), isWfs: line.isWfs == null ? undefined : line.isWfs ? 1 : 0, returnMethod: line.returnMethod, deliveryStatus: line.deliveryStatus, channelName: line.channelName, refundStatus: line.refundStatus, refundCoveredBy: line.refundCoveredBy, refundChannelCoveredBy: line.refundChannelCoveredBy, isReturnForException: line.isReturnForException == null ? undefined : line.isReturnForException ? 1 : 0, returnChannelName: line.returnChannelName });
        const status = line.status ?? existing?.status ?? 'UNKNOWN';
        const effectiveAmount = line.amount ?? (existing?.amount == null ? undefined : Number(existing.amount));
        const statusChanged = line.status != null && line.status !== existing?.status;
        const amountChanged = line.amount != null && (existing?.amount == null || line.amount !== Number(existing.amount));
        let event: Record<string, unknown> | undefined;
        if (statusChanged || amountChanged) {
          const sourceIdentity = `${line.id}:${status}:${effectiveAmount ?? ''}`;
          const eventId = createHash('sha256').update(sourceIdentity).digest('hex').slice(0, 64);
          event = { id: eventId, tenantId: line.tenantId, storeId: line.storeId, returnId: line.id, sourceIdentity, status, refundAmount: effectiveAmount == null ? null : String(effectiveAmount), returnedAt: optionalDate(line.returnedAt) ?? null, rawResponseId: line.rawResponseId, recordedAt: now };
        }
        const row = { id: line.id, tenantId: line.tenantId, storeId: line.storeId, returnOrderId: line.returnOrderId, orderId: line.orderId, orderNumber: line.orderNumber ?? null, customerOrderId: line.customerOrderId ?? null, returnOrderItemId: line.returnOrderItemId ?? null, itemId: line.itemId ?? null, sku: line.sku ?? null, productName: line.productName ?? null, quantity: line.quantity ?? null, status: line.status ?? 'UNKNOWN', amount: amount ?? null, currency: line.currency ?? null, reason: line.reason ?? null, reasonCode: line.reasonCode ?? null, returnedAt: line.returnedAt || null, returnInitiatedAt: optionalDate(line.returnInitiatedAt) ?? null, refundIssuedAt: optionalDate(line.refundIssuedAt) ?? null, isWfs: line.isWfs == null ? null : line.isWfs ? 1 : 0, returnMethod: line.returnMethod ?? null, deliveryStatus: line.deliveryStatus ?? null, channelName: line.channelName ?? null, refundStatus: line.refundStatus ?? null, refundCoveredBy: line.refundCoveredBy ?? null, refundChannelCoveredBy: line.refundChannelCoveredBy ?? null, isReturnForException: line.isReturnForException == null ? null : line.isReturnForException ? 1 : 0, returnChannelName: line.returnChannelName ?? null, createdAt: optionalDate(line.createdAt) ?? null, updatedAt: now };
        return { row, updates, event };
      });
      const columns: Record<string, string> = { orderId: 'order_id', orderNumber: 'order_number', customerOrderId: 'customer_order_id', returnOrderId: 'return_order_id', returnOrderItemId: 'return_order_item_id', itemId: 'item_id', sku: 'sku', productName: 'product_name', quantity: 'quantity', status: 'status', amount: 'amount', currency: 'currency', reason: 'reason', reasonCode: 'reason_code', returnedAt: 'returned_at', returnInitiatedAt: 'return_initiated_at', refundIssuedAt: 'refund_issued_at', isWfs: 'is_wfs', returnMethod: 'return_method', deliveryStatus: 'delivery_status', channelName: 'channel_name', refundStatus: 'refund_status', refundCoveredBy: 'refund_covered_by', refundChannelCoveredBy: 'refund_channel_covered_by', isReturnForException: 'is_return_for_exception', returnChannelName: 'return_channel_name' };
      const groups = new Map<string, typeof rows>();
      for (const item of rows) { const key = Object.keys(item.updates).join(','); const group = groups.get(key) ?? []; group.push(item); groups.set(key, group); }
      for (const group of groups.values()) {
        const fields = Object.keys(group[0].updates);
        const set = Object.fromEntries(fields.map((field) => [field, sql.raw(`VALUES(\`${columns[field]}\`)`)]));
        await db.insert(returnRecords).values(group.map(({ row }) => row) as never).onDuplicateKeyUpdate({ set: { returnedAt: sql.raw('VALUES(`returned_at`)'), updatedAt: sql.raw('VALUES(`updated_at`)'), ...set } });
      }
      const events = rows.flatMap(({ event }) => event ? [event] : []);
      if (events.length) await db.insert(returnStatusEvents).values(events as never).onDuplicateKeyUpdate({ set: { id: sql.raw('VALUES(`id`)') } });
    }
  }
  return {
    get previousOrderDates() { return [...previousOrderDates]; },
    flushOrderLines,
    flushReturnLines,
    raw: createCommerceRawWriter(async (row) => { await db.insert(rawPayloads).values(row); }),
    async orderLine(line: import('./syncOrders.js').NormalizedOrderLine) {
      pendingOrderLines.push({ line, now: new Date() });
      if (pendingOrderLines.length >= 100) await flushOrderLines();
    },
    async returnLine(line: import('./syncReturns.js').NormalizedReturn) {
      const now = optionalDate(line.updatedAt) ?? new Date();
      pendingReturnLines.push({ line, now });
      if (pendingReturnLines.length >= 100) await flushReturnLines();
    },
  };
}

export async function replaceDailyFactRows<T>(days: string[], rows: T[], clearDay: (day: string) => Promise<void>, writeRow: (row: T) => Promise<void>) {
  for (const day of new Set(days)) await clearDay(day);
  for (const row of rows) await writeRow(row);
}

export function dailyRowsFromCompleteNormalizedData(
  orderRows: Array<{ id: string; tenantId: string; storeId: string; orderId: string; sku: string; quantity: number | string | null; amount: number | string | null; orderedAt: Date | null; rawResponseId: string; status?: string | null }>,
  returnRows: Array<{ id: string; tenantId: string; storeId: string; orderId: string; sku: string | null; amount: number | string | null; status: string; returnedAt: string | null; rawResponseId: string }>,
) {
  const facts = dailySalesFacts(orderRows.flatMap((row): SalesLine[] => row.orderedAt ? [{ id: row.id, tenantId: row.tenantId, storeId: row.storeId, orderId: row.orderId, sku: row.sku, ...(row.quantity == null ? {} : { quantity: Number(row.quantity) }), ...(row.amount == null ? {} : { amount: Number(row.amount) }), orderedAt: row.orderedAt.toISOString(), rawResponseId: row.rawResponseId, status: row.status }] : []), returnRows.filter((row): row is typeof row & { returnedAt: string } => row.returnedAt != null).map((row) => ({ id: row.id, tenantId: row.tenantId, storeId: row.storeId, orderId: row.orderId, sku: row.sku ?? '', ...(row.amount == null ? {} : { amount: Number(row.amount) }), status: row.status, returnedAt: row.returnedAt, rawResponseId: row.rawResponseId })));
  return dailyFactRows(facts);
}

function pacificDateBoundary(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, date);
  let instant = localMidnightAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt++) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second));
    instant = localMidnightAsUtc - (localAsUtc - instant);
  }
  return new Date(instant);
}

async function rebuildDailyFacts(db: ReturnType<typeof createDb>['db'], tenantId: string, storeId: string, changedOrderIds: string[], previousOrderDates: string[] = []) {
  if (changedOrderIds.length === 0 && previousOrderDates.length === 0) return;
  const knownOrders: Array<{ id: string; orderedAt: Date | null }> = [];
  for (let offset = 0; offset < changedOrderIds.length; offset += 500) {
    knownOrders.push(...await db.select({ id: orders.id, orderedAt: orders.orderedAt }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.storeId, storeId), inArray(orders.id, changedOrderIds.slice(offset, offset + 500)))));
  }
  const affectedDays = [...new Set([...previousOrderDates, ...knownOrders.flatMap((row) => row.orderedAt ? [salesDateInPacificTime(row.orderedAt.toISOString())] : [])])];
  if (affectedDays.length === 0) return;
  const dayConditions = affectedDays.map((day) => {
    const start = pacificDateBoundary(day);
    const nextDay = new Date(`${day}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const end = pacificDateBoundary(nextDay.toISOString().slice(0, 10));
    return and(gte(orders.orderedAt, start), lt(orders.orderedAt, end));
  });
  const fullDayOrders = await db.select({ id: orderLines.id, tenantId: orderLines.tenantId, storeId: orderLines.storeId, orderId: orderLines.orderId, sku: skus.externalId, quantity: orderLines.quantity, amount: orderLines.lineAmount, orderedAt: orders.orderedAt, rawResponseId: orders.id, status: orders.status }).from(orderLines).innerJoin(orders, eq(orderLines.orderId, orders.id)).innerJoin(skus, eq(orderLines.skuId, skus.id)).where(and(eq(orders.tenantId, tenantId), eq(orders.storeId, storeId), or(...dayConditions)));
  const affectedOrderIds = [...new Set(fullDayOrders.map((row) => row.orderId))];
  const fullDayReturns = affectedOrderIds.length ? await db.select({ id: returnRecords.id, tenantId: returnRecords.tenantId, storeId: returnRecords.storeId, orderId: returnRecords.orderId, sku: returnRecords.sku, amount: returnRecords.amount, status: returnRecords.status, returnedAt: returnRecords.returnedAt, rawResponseId: returnRecords.id }).from(returnRecords).where(and(eq(returnRecords.tenantId, tenantId), eq(returnRecords.storeId, storeId), inArray(returnRecords.orderId, affectedOrderIds))) : [];
  const rows = dailyRowsFromCompleteNormalizedData(fullDayOrders, fullDayReturns);
  await db.transaction(async (tx) => replaceDailyFactRows(affectedDays, rows,
    async (day) => { await tx.delete(dailyFacts).where(and(eq(dailyFacts.tenantId, tenantId), eq(dailyFacts.storeId, storeId), eq(dailyFacts.factDate, new Date(`${day}T00:00:00.000Z`)), inArray(dailyFacts.metric, ['revenue', 'orders', 'units', 'refunds']))); },
    async (row) => {
      const id = `${row.storeId}:${row.factDate}:${row.metric}`;
      await tx.insert(dailyFacts).values({ id, tenantId: row.tenantId, storeId: row.storeId, factDate: new Date(`${row.factDate}T00:00:00.000Z`), metric: row.metric, value: row.value, ...(row.currency ? { currency: row.currency } : {}) }).onDuplicateKeyUpdate({ set: { tenantId: row.tenantId, value: row.value, currency: row.currency } });
    },
  ));
}

export async function syncOrdersToDatabase(window: ReplayWindow, connection: WalmartConnection) {
  const { db } = createDb();
  const write = createCommerceDatabaseWriter(db);
  let lines: Awaited<ReturnType<typeof syncOrders>>;
  try {
    lines = await syncOrders(window, connection, async (payload, id) => { await archiveOrderPage(payload,{tenantId:window.tenantId,storeId:window.storeId,sourceId:id,capturedAt:new Date()}); }, write.orderLine);
  } finally {
    await write.flushOrderLines();
  }
  await rebuildDailyFacts(db, window.tenantId, window.storeId, [...new Set(lines.map((line) => line.orderId))], write.previousOrderDates);
  return { written: lines.length };
}

export async function syncReturnsToDatabase(window: ReturnWindow, connection: WalmartConnection) {
  const { db } = createDb();
  const write = createCommerceDatabaseWriter(db);
  const changedOrderIds = new Set<string>();
  let count: number;
  try { count = await syncReturns(window, connection, (payload, id) => write.raw({ tenantId: window.tenantId, storeId: window.storeId, resource: 'returns' }, payload, id), async (line) => { changedOrderIds.add(line.orderId); await write.returnLine(line); }); }
  finally { await write.flushReturnLines(); }
  await rebuildDailyFacts(db, window.tenantId, window.storeId, [...changedOrderIds]);
  return count;
}
