import { expect, it } from 'vitest';
import { normalizeReturnPayload, replayReturnPages } from './syncReturns.js';
import { planReturnsIncremental } from '../sync/returnsBackfillPlanner.js';

it('normalizes refund and status snapshots with raw response IDs', () => {
  const rows = normalizeReturnPayload({ returns: [{ returnOrderId: 'r1', customerOrderId: 'o1', returnDate: '2026-01-04T00:00:00Z', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REFUNDED', refundAmount: { amount: 5 } }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw-return' });
  expect(rows).toMatchObject([{ id: 's:r1:1', orderId: 's:o1', sku: 'A', status: 'REFUNDED', amount: 5, rawResponseId: 'raw-return' }]);
});

it('preserves legacy return identifiers, quantity, refund and fulfillment fields', () => {
  const [row] = normalizeReturnPayload({ returns: [{ returnOrderId: 'r1', purchaseOrderId: 'p1', customerOrderId: 'c1', returnOrderDate: '2026-01-04T00:00:00Z', returnInitiatedDate: '2026-01-03T00:00:00Z', refundIssuedDate: '2026-01-05T00:00:00Z', returnMethod: 'MAIL', deliveryStatus: 'DELIVERED', channelName: 'ONLINE', refundStatus: 'ISSUED', isWfs: true, returnOrderLines: [{ returnOrderLineNumber: 'line-9', item: { sku: 'A', productId: 'item-1', productName: 'Product A' }, quantity: { amount: 2 }, returnReason: { code: 'DAMAGED', description: 'Damaged' }, refundAmount: { amount: 12, currency: 'USD' }, status: 'REFUNDED' }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw-return' });
  expect(row).toMatchObject({ returnOrderId: 'r1', orderNumber: 'p1', customerOrderId: 'c1', returnOrderItemId: 'line-9', itemId: 'item-1', sku: 'A', productName: 'Product A', quantity: 2, amount: 12, currency: 'USD', status: 'REFUNDED', reason: 'Damaged', reasonCode: 'DAMAGED', returnInitiatedAt: '2026-01-03T00:00:00.000Z', refundIssuedAt: '2026-01-05T00:00:00.000Z', isWfs: true, returnMethod: 'MAIL', deliveryStatus: 'DELIVERED', channelName: 'ONLINE', refundStatus: 'ISSUED' });
});

it('stores Walmart returnReason as the code and returnDescription as the human-readable reason', () => {
  const [row] = normalizeReturnPayload({ returnOrders: [{
    returnOrderId: '195859961461639547',
    customerOrderId: '200015562518886',
    returnOrderLines: [{
      returnOrderLineNumber: 1,
      returnReason: 'RETURN_TO_SENDER',
      returnDescription: 'Unable to deliver',
    }],
  }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });

  expect(row).toMatchObject({ reason: 'Unable to deliver', reasonCode: 'RETURN_TO_SENDER' });
});

it('normalizes Walmart refund responsibility and return context fields', () => {
  const [row] = normalizeReturnPayload({ returnOrders: [{
    returnOrderId: 'r-responsibility',
    returnChannel: { channelName: 'SELFSERVE' },
    returnOrderLines: [{
      returnOrderLineNumber: 1,
      returnReason: 'DAMAGED',
      returnDescription: 'Item arrived damaged',
      refundCoveredBy: 'Seller',
      refundChannels: [{ refundCoveredBy: 'Walmart' }],
      isReturnForException: true,
    }],
  }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });

  expect(row).toMatchObject({
    reason: 'Item arrived damaged',
    reasonCode: 'DAMAGED',
    refundCoveredBy: 'Seller',
    refundChannelCoveredBy: 'Walmart',
    isReturnForException: true,
    returnChannelName: 'SELFSERVE',
    channelName: 'SELFSERVE',
  });
});

it('keeps return rows with missing SKUs instead of dropping historical business records', () => {
  const rows = normalizeReturnPayload({ returns: [{ returnOrderId: 'r1', returnOrderLines: [{ lineNumber: '1', quantity: 1, refundAmount: 4 }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(rows).toHaveLength(1);
  expect(rows[0].sku).toBeUndefined();
});

it('keeps an absent return status and refund amount undefined for non-destructive upserts', () => {
  const [row] = normalizeReturnPayload({ returns: [{ returnOrderId: 'r1', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' } }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(row.status).toBeUndefined();
  expect(row.amount).toBeUndefined();
});

it('keeps a return with no usable date instead of normalizing an empty date string', () => {
  const [row] = normalizeReturnPayload({ returns: [{ returnOrderId: 'r-no-date', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' } }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(row.returnedAt).toBeUndefined();
});

it('replays all return pages within an overlapping modified window', async () => {
  const queries: Array<Record<string, string>> = [];
  const rows = await replayReturnPages({ tenantId: 't', storeId: 's', from: '2026-01-04T00:00:00Z', to: '2026-01-05T00:00:00Z', overlapMs: 60_000 }, async (query) => {
    queries.push(query);
    return query.cursor ? { returns: [{ returnOrderId: 'r2', returnOrderLines: [{ lineNumber: '1', item: { sku: 'B' } }] }] } : { returns: [{ returnOrderId: 'r1', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' } }] }], nextCursor: '?limit=200&cursor=next&returnLastModifiedStartDate=2026-01-03T23%3A59%3A00.000Z&returnLastModifiedEndDate=2026-01-05T00%3A00%3A00Z' };
  });
  expect(rows.map((row) => row.id)).toEqual(['s:r1:1', 's:r2:1']);
  expect(queries[0]).toMatchObject({ returnLastModifiedStartDate: '2026-01-03T23:59:00.000Z', returnLastModifiedEndDate: '2026-01-05T00:00:00Z' });
  expect(queries[1]).toMatchObject({ limit: '200', cursor: 'next', returnLastModifiedStartDate: '2026-01-03T23:59:00.000Z' });
  expect(queries[1]).not.toHaveProperty('nextCursor');
});

it('reads nested Walmart return amount and cursor', async () => {
  const rows = await replayReturnPages({ tenantId: 't', storeId: 's', from: '2026-01-01', to: '2026-01-02' }, async (query) => query.cursor ? { returnOrders: [{ returnOrderId: 'r2', returnOrderLines: [{ item: { sku: 'B' }, chargeTotals: [{ name: 'lineTotal', value: { currencyAmount: 12 } }] }] }] } : { returnOrders: [{ returnOrderId: 'r1', returnOrderLines: [{ item: { sku: 'A' }, chargeTotals: [{ name: 'lineTotal', value: { currencyAmount: 8 } }] }] }], meta: { nextCursor: '?cursor=c2' } });
  expect(rows.map((row) => row.amount)).toEqual([undefined, undefined]);
});

it('queries the incremental overlap window so changed return statuses are re-read', async () => {
  const query = planReturnsIncremental(new Date('2026-10-16T12:00:00Z'));
  const requests: Array<Record<string, string>> = [];
  await replayReturnPages({ tenantId: 't', storeId: 's', from: query.from, to: query.to }, async (params) => {
    requests.push(params);
    return { returns: [] };
  });
  expect(requests[0]).toMatchObject({ returnLastModifiedStartDate: query.from, returnLastModifiedEndDate: query.to });
});

it('normalizes Walmart return measurement and explicit total refund fields', () => {
  const [row] = normalizeReturnPayload({ returnOrders: [{
    returnOrderId: 'RETURN-REAL-SHAPE',
    customerOrderId: 'CUSTOMER-1',
    returnOrderDate: '2026-11-03T10:00:00Z',
    totalRefundAmount: { currencyUnit: 'USD', currencyAmount: 8 },
    returnOrderLines: [{
      returnOrderLineNumber: '2',
      item: { sku: 'SKU-1', productName: 'Product' },
      quantity: { unitOfMeasure: 'EA', measurementValue: 2 },
      chargeTotals: [{ name: 'lineTotal', value: { currencyUnit: 'USD', currencyAmount: 8 } }],
      currentRefundStatus: 'REFUNDED',
    }],
  }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });

  expect(row).toMatchObject({ quantity: 2, amount: 8, currency: 'USD', status: 'REFUNDED' });
});

it('does not infer a refund from the product line total', () => {
  const [row] = normalizeReturnPayload({ returnOrders: [{ returnOrderId: 'RETURN-SCALAR-TOTAL', customerOrderId: 'PO-1', returnOrderDate: '2026-11-03T10:00:00Z', returnOrderLines: [{ returnOrderLineNumber: '1', item: { sku: 'SKU-1' }, quantity: { unitOfMeasure: 'EA', measurementValue: 1 }, chargeTotals: [{ name: 'LINETOTAL', value: 14.25 }] }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(row.amount).toBeUndefined();
});

it('does not treat lineTotal as the actual refund amount', () => {
  const [row] = normalizeReturnPayload({ returnOrders: [{ returnOrderId: 'R-1', returnOrderDate: '2026-11-03T10:00:00Z', totalRefundAmount: { currencyUnit: 'USD', currencyAmount: 7 }, returnOrderLines: [{ returnOrderLineNumber: '1', item: { sku: 'SKU' }, quantity: { measurementValue: 2 }, refundedQty: 1, chargeTotals: [{ name: 'lineTotal', value: { currencyUnit: 'USD', currencyAmount: 24 } }] }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw' });
  expect(row.amount).toBe(7);
});
