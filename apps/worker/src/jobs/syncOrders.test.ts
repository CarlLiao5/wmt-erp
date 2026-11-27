import { expect, it } from 'vitest';
import { normalizeOrderPayload, replayOrderPages } from './syncOrders.js';

it('normalizes every order line with a stable raw response reference', () => {
  const rows = normalizeOrderPayload({ list: { elements: [{ purchaseOrderId: 'po-1', orderDate: '2026-01-02T01:00:00Z', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' }, orderLineQuantity: { amount: '2' }, orderLineStatuses: { orderLineStatus: [{ status: 'Shipped' }] }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 12 } }] } }, { lineNumber: '2', item: { sku: 'B' }, orderLineQuantity: { amount: '1' }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 7 } }] } }] } }] } }, { tenantId: 't', storeId: 's', rawResponseId: 'raw-1' });
  expect(rows.map((row) => ({ id: row.id, sku: row.sku, quantity: row.quantity, amount: row.amount, status: row.status, rawResponseId: row.rawResponseId }))).toEqual([
    { id: 's:po-1:1', sku: 'A', quantity: 2, amount: 12, status: 'Shipped', rawResponseId: 'raw-1' },
    { id: 's:po-1:2', sku: 'B', quantity: 1, amount: 7, status: '', rawResponseId: 'raw-1' }
  ]);
});

it('replays overlapping modified windows and pages without duplicate normalized lines', async () => {
  const requests: Array<Record<string, string>> = [];
  const pages = async (query: Record<string, string>) => { requests.push(query); return query.soIndex ? { orders: [{ purchaseOrderId: 'po-2', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'B' } }] } }] } : { orders: [{ purchaseOrderId: 'po-1', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }], nextCursor: '?limit=200&hasMoreElements=true&soIndex=200&poIndex=200&createdStartDate=2026-01-01&createdEndDate=2026-01-03' }; };
  const first = await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02T00:00:00.123Z', to: '2026-01-03T00:00:00.456Z', overlapMs: 60_000 }, pages);
  const second = await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02T00:00:00.123Z', to: '2026-01-03T00:00:00.456Z', overlapMs: 60_000 }, pages);
  expect(first.map((line) => line.id)).toEqual(['s:po-1:1', 's:po-2:1']);
  expect(second.map((line) => line.id)).toEqual(first.map((line) => line.id));
  expect(requests[0]).toMatchObject({ createdStartDate: '2026-01-01T23:59:00Z', createdEndDate: '2026-01-03T00:00:00Z' });
  expect(requests[1]).toMatchObject({ limit: '200', soIndex: '200', poIndex: '200', createdStartDate: '2026-01-01', createdEndDate: '2026-01-03' });
  expect(requests[1]).not.toHaveProperty('nextCursor');
});

it('upserts each stable line once when Walmart repeats it across pages', async () => {
  const ids: string[] = [];
  await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02', to: '2026-01-03' }, async (query) => ({ orders: [{ purchaseOrderId: 'po-1', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }], nextCursor: query.soIndex ? undefined : '?soIndex=200' }), undefined, async (line) => { ids.push(line.id); });
  expect(ids).toEqual(['s:po-1:1']);
});

it('fails a replay when Walmart repeats a pagination cursor instead of reporting a partial success', async () => {
  let calls = 0;
  await expect(replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02', to: '2026-01-03' }, async () => {
    calls += 1;
    return { orders: [{ purchaseOrderId: `p${calls}`, orderLines: { orderLine: [{ item: { sku: 'A' } }] } }], nextCursor: '?soIndex=200' };
  })).rejects.toThrow('Repeated Walmart order cursor');
  expect(calls).toBe(2);
});

it('sums every PRODUCT charge without including shipping', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'p', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 4 } }, { chargeType: 'SHIPPING', chargeAmount: { amount: 9 } }, { chargeType: 'PRODUCT', chargeAmount: { amount: 6 } }] } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line.amount).toBe(10);
});

it('falls back to unit price times quantity when PRODUCT charges have no amount', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'PO-MISSING-CHARGE-AMOUNT', orderLines: { orderLine: [{ item: { sku: 'SKU-1' }, orderLineQuantity: { amount: 3 }, unitPrice: { amount: 7.5 }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: {} }] } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line.amount).toBe(22.5);
});

it('preserves the legacy order and order-item fields available in the Walmart response', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'p', customerOrderId: 'customer-1', customerEmail: 'buyer@example.com', orderDate: '2026-01-02T01:00:00Z', estimatedDeliveryDate: '2026-01-05T00:00:00Z', shippingInfo: { postalAddress: { postalCode: '90001', city: 'Los Angeles', state: 'CA', country: 'US' } }, fulfillmentOption: 'WFS', shipMethod: 'Standard', orderTotal: { amount: 21, currency: 'USD' }, orderLines: { orderLine: [{ lineNumber: '7', item: { sku: 'A', productId: 'item-1', productName: 'Product A', upc: '123456789012' }, orderLineQuantity: { amount: 2 }, unitPrice: { amount: 6 }, orderLineStatuses: { orderLineStatus: [{ status: 'Shipped' }] }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 12, currency: 'USD' } }, { chargeType: 'SHIPPING', chargeAmount: { amount: 9, currency: 'USD' } }] } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line).toMatchObject({ orderNumber: 'p', customerOrderId: 'customer-1', customerEmail: 'buyer@example.com', estimatedDeliveryAt: '2026-01-05T00:00:00.000Z', postalCode: '90001', city: 'Los Angeles', state: 'CA', country: 'US', fulfillmentOption: 'WFS', shipMethod: 'Standard', orderTotalAmount: 21, lineNumber: '7', upc: '123456789012', productName: 'Product A', unitPrice: 6, shippingCharge: 9, currency: 'USD', itemStatus: 'Shipped' });
});

it('leaves absent optional order fields undefined so upserts can preserve existing values', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'p', orderLines: { orderLine: [{ item: { sku: 'A' } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line.customerEmail).toBeUndefined();
  expect(line.estimatedDeliveryAt).toBeUndefined();
  expect(line.shippingCharge).toBeUndefined();
  expect(line.isWfs).toBeUndefined();
  expect(line.orderTotalAmount).toBeUndefined();
  expect(line.currency).toBeUndefined();
  expect(line.orderedAt).toBeUndefined();
});

it('reads Walmart list.elements.order and nested pagination cursor', async () => {
  const requests: Array<Record<string, string>> = [];
  const rows = await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-01', to: '2026-01-02' }, async (query) => { requests.push(query); return query.soIndex ? { list: { elements: { order: [{ purchaseOrderId: 'p2', orderLines: { orderLine: [{ item: { sku: 'B' } }] } }] } } } : { list: { elements: { order: [{ purchaseOrderId: 'p1', orderLines: { orderLine: [{ item: { sku: 'A' } }] } }] }, meta: { nextCursor: '?limit=200&soIndex=200&createdStartDate=2026-01-01&createdEndDate=2026-01-02' } } }; });
  expect(rows).toHaveLength(2);
  expect(requests[1]).toMatchObject({ soIndex: '200', createdStartDate: '2026-01-01' });
});

it('normalizes fulfillment and contact fields from the current Walmart order-list shape', () => {
  const [line] = normalizeOrderPayload({ list: { elements: { order: [{
    purchaseOrderId: 'PO-REAL-SHAPE',
    customerEmailId: 'masked@example.test',
    shipNode: { type: 'WFSFulfilled' },
    orderLines: { orderLine: [{
      lineNumber: '3',
      item: { sku: 'SKU-1', productName: 'Product' },
      orderLineQuantity: { amount: 2, unitOfMeasurement: 'EACH' },
      fulfillment: { fulfillmentOption: 'DELIVERY', shipMethod: 'TwoDay', shippingProgramType: 'WFS' },
      charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 12, currency: 'USD' } }] },
    }] },
  }] } } }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });

  expect(line).toMatchObject({ customerEmail: 'masked@example.test', fulfillmentOption: 'DELIVERY', shipMethod: 'TwoDay', isWfs: true });
});

it('derives line sales from unit price and quantity when Walmart omits PRODUCT charges', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'PO-NO-CHARGES', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'SKU-1' }, orderLineQuantity: { amount: 3 }, unitPrice: { amount: 7.5, currency: 'USD' } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line).toMatchObject({ quantity: 3, unitPrice: 7.5, amount: 22.5, currency: 'USD' });
});

it('preserves missing order quantity and amount instead of fabricating zeros', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'PO-MISSING', orderLines: { orderLine: [{ item: { sku: 'SKU-1' } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line.quantity).toBeUndefined();
  expect(line.amount).toBeUndefined();
});
