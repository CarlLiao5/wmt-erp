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
  const pages = async (query: Record<string, string>) => { requests.push(query); return query.nextCursor ? { orders: [{ purchaseOrderId: 'po-2', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'B' } }] } }], nextCursor: undefined } : { orders: [{ purchaseOrderId: 'po-1', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }], nextCursor: 'page-2' }; };
  const first = await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02T00:00:00Z', to: '2026-01-03T00:00:00Z', overlapMs: 60_000 }, pages);
  const second = await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02T00:00:00Z', to: '2026-01-03T00:00:00Z', overlapMs: 60_000 }, pages);
  expect(first.map((line) => line.id)).toEqual(['s:po-1:1', 's:po-2:1']);
  expect(second.map((line) => line.id)).toEqual(first.map((line) => line.id));
  expect(requests[0]).toMatchObject({ lastModifiedStartDate: '2026-01-01T23:59:00.000Z', lastModifiedEndDate: '2026-01-03T00:00:00Z' });
  expect(requests[1]?.nextCursor).toBe('page-2');
});

it('upserts each stable line once when Walmart repeats it across pages', async () => {
  const ids: string[] = [];
  await replayOrderPages({ tenantId: 't', storeId: 's', from: '2026-01-02', to: '2026-01-03' }, async (query) => ({ orders: [{ purchaseOrderId: 'po-1', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }], nextCursor: query.nextCursor ? undefined : 'second' }), undefined, async (line) => { ids.push(line.id); });
  expect(ids).toEqual(['s:po-1:1']);
});

it('sums every PRODUCT charge without including shipping', () => {
  const [line] = normalizeOrderPayload({ orders: [{ purchaseOrderId: 'p', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 4 } }, { chargeType: 'SHIPPING', chargeAmount: { amount: 9 } }, { chargeType: 'PRODUCT', chargeAmount: { amount: 6 } }] } }] } }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(line.amount).toBe(10);
});
