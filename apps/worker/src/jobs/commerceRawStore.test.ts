import { expect, it } from 'vitest';
import { createCommerceRawWriter, createCommerceDatabaseWriter, dailyRowsFromCompleteNormalizedData, replaceDailyFactRows, presentFields } from './commerceRawStore.js';
import { completedSyncJobUpdate } from '../queue.js';
import { orders, orderLines, returnRecords, returnStatusEvents, skus } from '../../../../packages/db/index.js';

it('appends immutable raw pages with tenant, store and resource provenance', async () => {
  const records: unknown[] = [];
  const write = createCommerceRawWriter(async (row) => { records.push(row); });
  const payload = { orders: [{ purchaseOrderId: 'o1' }] };
  await write({ tenantId: 't', storeId: 's', resource: 'orders' }, payload, 'raw-1');
  payload.orders[0].purchaseOrderId = 'changed';
  expect(records).toMatchObject([{ tenantId: 't', storeId: 's', resource: 'orders', externalId: 'raw-1', correlationId: 'raw-1', httpStatus: 200, payload: { orders: [{ purchaseOrderId: 'o1' }] } }]);
});

it('omits absent optional fields from updates so older normalized values are preserved', () => {
  expect(presentFields({ customerEmail: undefined, state: 'CA', isWfs: false })).toEqual({ state: 'CA', isWfs: false });
});

function fakeDb(initial: Array<{ table: object; row: Record<string, unknown> }> = []) {
  const tables = new Map<object, Map<string, Record<string, unknown>>>();
  const insertCalls: Array<{ table: object; size: number }> = [];
  const selectCalls: object[] = [];
  for (const { table, row } of initial) {
    const rows = tables.get(table) ?? new Map();
    rows.set(String(row.id), { ...row });
    tables.set(table, rows);
  }
  return {
    db: {
      select: () => ({ from: (table: object) => { selectCalls.push(table); const result = () => [...(tables.get(table)?.values() ?? [])]; return { where: () => ({ limit: async (size: number) => result().slice(0, size), then: (resolve: (rows: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) }) }; } }),
      insert: (table: object) => ({ values: (input: Record<string, unknown> | Record<string, unknown>[]) => ({ onDuplicateKeyUpdate: async ({ set }: { set: Record<string, unknown> }) => {
        const rows = tables.get(table) ?? new Map();
        const values = Array.isArray(input) ? input : [input];
        insertCalls.push({ table, size: values.length });
        for (const row of values) {
          const id = String(row.id);
          rows.set(id, rows.has(id) ? { ...rows.get(id), ...set } : { ...row });
        }
        tables.set(table, rows);
      } }) }),
    },
    rows: (table: object) => [...(tables.get(table)?.values() ?? [])],
    insertCalls,
    selectCalls,
  };
}

it('preserves known order totals, currency, and dates when an API replay omits them', async () => {
  const oldOrder = { id: 's:p1', tenantId: 't', storeId: 's', externalId: 'p1', status: 'Shipped', orderedAt: new Date('2026-01-02T00:00:00Z'), totalAmount: '42.00', currency: 'CAD', updatedAt: new Date() };
  const oldLine = { id: 's:p1:1', tenantId: 't', storeId: 's', orderId: 's:p1', skuId: 's:A', quantity: '1', lineAmount: '42.00', currency: 'CAD' };
  const fake = fakeDb([{ table: orders, row: oldOrder }, { table: orderLines, row: oldLine }, { table: skus, row: { id: 's:A', tenantId: 't', storeId: 's', externalId: 'A' } }]);
  const writer = createCommerceDatabaseWriter(fake.db as never);
  await writer.orderLine({ id: 's:p1:1', tenantId: 't', storeId: 's', orderId: 's:p1', orderNumber: 'p1', sku: 'A', quantity: 1, amount: 42, orderedAt: undefined, status: '', rawResponseId: 'raw', orderTotalAmount: undefined, currency: undefined, lineNumber: '1', itemStatus: '' });
  await writer.flushOrderLines();
  expect(fake.rows(orders)[0]).toMatchObject({ status: 'Shipped', totalAmount: '42.00', currency: 'CAD', orderedAt: oldOrder.orderedAt });
});

it('retains the old business date before an order date is updated', async () => {
  const oldOrder = { id: 's:p1', tenantId: 't', storeId: 's', externalId: 'p1', status: 'Shipped', orderedAt: new Date('2026-01-02T07:30:00Z'), totalAmount: '42.00', currency: 'USD', updatedAt: new Date() };
  const fake = fakeDb([{ table: orders, row: oldOrder }, { table: skus, row: { id: 's:A', tenantId: 't', storeId: 's', externalId: 'A' } }]);
  const writer = createCommerceDatabaseWriter(fake.db as never);
  await writer.orderLine({ id: 's:p1:1', tenantId: 't', storeId: 's', orderId: 's:p1', orderNumber: 'p1', sku: 'A', quantity: 1, amount: 42, orderedAt: '2026-01-03T08:30:00.000Z', status: 'Shipped', rawResponseId: 'raw', lineNumber: '1', itemStatus: '' });
  await writer.flushOrderLines();
  expect(writer.previousOrderDates).toEqual(['2026-01-01']);
});

it('batches order lines before writing them so a page does not issue one line insert per item', async () => {
  const fake = fakeDb();
  const writer = createCommerceDatabaseWriter(fake.db as never);
  const base = { tenantId: 't', storeId: 's', orderId: 's:p1', orderNumber: 'p1', sku: 'A', quantity: 1, amount: 42, orderedAt: '2026-01-03T08:30:00.000Z', status: 'Shipped', rawResponseId: 'raw', itemStatus: '', currency: 'USD' };
  await writer.orderLine({ ...base, id: 's:p1:1', lineNumber: '1' });
  await writer.orderLine({ ...base, id: 's:p1:2', lineNumber: '2' });
  expect(fake.rows(orderLines)).toHaveLength(0);
  await writer.flushOrderLines();
  expect(fake.rows(orderLines)).toHaveLength(2);
  expect(fake.insertCalls.filter((call) => call.table === orderLines)).toEqual([{ table: orderLines, size: 2 }]);
});

it('stores only a bounded summary for completed order sync results', () => {
  const update = completedSyncJobUpdate(new Date('2026-11-05T00:00:00Z'), { written: 12_000 });
  expect(update).toEqual({ status: 'completed', completedAt: new Date('2026-11-05T00:00:00Z'), resultPayload: { written: 12_000 } });
  expect(JSON.stringify(update.resultPayload).length).toBeLessThan(100);
});

it('resolves and writes unique SKUs and orders once per batch instead of once per line', async () => {
  const fake = fakeDb();
  const writer = createCommerceDatabaseWriter(fake.db as never);
  for (const [orderNumber, sku] of [['p1', 'A'], ['p2', 'B']] as const) {
    await writer.orderLine({ id: `s:${orderNumber}:1`, tenantId: 't', storeId: 's', orderId: `s:${orderNumber}`, orderNumber, sku, quantity: 1, amount: 42, orderedAt: '2026-01-03T08:30:00.000Z', status: 'Shipped', rawResponseId: 'raw', lineNumber: '1', itemStatus: '', itemId: `item-${sku}` });
  }
  expect(fake.selectCalls).toEqual([]);
  await writer.flushOrderLines();
  expect(fake.selectCalls.filter((table) => table === orders)).toHaveLength(1);
  expect(fake.selectCalls.filter((table) => table === skus)).toHaveLength(1);
  expect(fake.insertCalls.filter((call) => call.table === orders)).toEqual([{ table: orders, size: 2 }]);
  expect(fake.insertCalls.filter((call) => call.table === skus)).toEqual([{ table: skus, size: 2 }]);
  expect(fake.insertCalls.filter((call) => call.table === orderLines)).toEqual([{ table: orderLines, size: 2 }]);
});

it('preserves return status and amount when omitted, and writes an idempotent event on a real change', async () => {
  const oldReturn = { id: 's:r1:1', tenantId: 't', storeId: 's', returnOrderId: 'r1', orderId: 's:p1', status: 'RECEIVED', amount: '9.00', returnedAt: '2026-01-04' };
  const fake = fakeDb([{ table: returnRecords, row: oldReturn }]);
  const writer = createCommerceDatabaseWriter(fake.db as never);
  const base = { id: 's:r1:1', tenantId: 't', storeId: 's', returnOrderId: 'r1', orderId: 's:p1', returnedAt: '2026-01-04', rawResponseId: 'raw' };
  await writer.returnLine({ ...base, status: undefined, amount: undefined });
  await writer.flushReturnLines();
  expect(fake.rows(returnRecords)[0]).toMatchObject({ status: 'RECEIVED', amount: '9.00' });
  expect(fake.rows(returnStatusEvents)).toHaveLength(0);
  await writer.returnLine({ ...base, status: 'REFUNDED', amount: 9 });
  await writer.returnLine({ ...base, status: 'REFUNDED', amount: 9 });
  await writer.flushReturnLines();
  expect(fake.rows(returnStatusEvents)).toHaveLength(1);
  expect(fake.rows(returnStatusEvents)[0]).toMatchObject({ returnId: 's:r1:1', status: 'REFUNDED', refundAmount: '9', rawResponseId: 'raw' });
});

it('records an initial refund amount even when Walmart has not returned a status yet', async () => {
  const fake = fakeDb();
  const writer = createCommerceDatabaseWriter(fake.db as never);
  await writer.returnLine({ id: 's:r2:1', tenantId: 't', storeId: 's', returnOrderId: 'r2', orderId: 's:p2', returnedAt: '2026-01-04', rawResponseId: 'raw', amount: 4 });
  await writer.flushReturnLines();
  expect(fake.rows(returnStatusEvents)).toHaveLength(1);
  expect(fake.rows(returnStatusEvents)[0]).toMatchObject({ returnId: 's:r2:1', status: 'UNKNOWN', refundAmount: '4' });
});

it('batches return record reads and writes while preserving change events', async () => {
  const fake = fakeDb();
  const writer = createCommerceDatabaseWriter(fake.db as never);
  for (const suffix of ['1', '2', '3']) await writer.returnLine({ id: `s:r${suffix}:1`, tenantId: 't', storeId: 's', returnOrderId: `r${suffix}`, orderId: `s:p${suffix}`, returnedAt: '2026-01-04', rawResponseId: 'raw', status: 'REFUNDED', amount: 4 });
  await writer.flushReturnLines();
  expect(fake.rows(returnRecords)).toHaveLength(3);
  expect(fake.rows(returnStatusEvents)).toHaveLength(3);
  expect(fake.selectCalls.filter((table) => table === returnRecords)).toHaveLength(1);
  expect(fake.insertCalls.filter((call) => call.table === returnRecords)).toEqual([{ table: returnRecords, size: 3 }]);
  expect(fake.insertCalls.filter((call) => call.table === returnStatusEvents)).toEqual([{ table: returnStatusEvents, size: 3 }]);
});

it('rebuilds each affected day from all normalized orders and returns for that day', () => {
  const rows = dailyRowsFromCompleteNormalizedData([
    { id: 'l1', tenantId: 't', storeId: 's', orderId: 'p1', sku: 'A', quantity: 2, amount: 20, orderedAt: new Date('2026-01-04T12:00:00Z'), rawResponseId: 'raw-1', status: 'Acknowledged' },
    { id: 'l2', tenantId: 't', storeId: 's', orderId: 'p2', sku: 'B', quantity: 3, amount: 30, orderedAt: new Date('2026-01-04T13:00:00Z'), rawResponseId: 'raw-2', status: 'Shipped' },
  ], [{ id: 'r1', tenantId: 't', storeId: 's', orderId: 'p2', sku: 'B', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-05', rawResponseId: 'raw-r' }]);
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ factDate: '2026-01-04', metric: 'revenue', value: '50' }),
    expect.objectContaining({ factDate: '2026-01-04', metric: 'orders', value: '2' }),
    expect.objectContaining({ factDate: '2026-01-04', metric: 'units', value: '5' }),
    expect.objectContaining({ factDate: '2026-01-04', metric: 'refunds', value: '5' }),
  ]));
});

it('rebuilds daily facts from every non-cancelled order status only', () => {
  const rows = dailyRowsFromCompleteNormalizedData([
    { id: 'l1', tenantId: 't', storeId: 's', orderId: 'ack', sku: 'A', quantity: 1, amount: 10, orderedAt: new Date('2026-01-04T12:00:00Z'), rawResponseId: 'raw-1', status: 'Acknowledged' },
    { id: 'l2', tenantId: 't', storeId: 's', orderId: 'shipped', sku: 'A', quantity: 2, amount: 20, orderedAt: new Date('2026-01-04T13:00:00Z'), rawResponseId: 'raw-2', status: 'Shipped' },
    { id: 'l3', tenantId: 't', storeId: 's', orderId: 'cancel', sku: 'A', quantity: 9, amount: 90, orderedAt: new Date('2026-01-04T14:00:00Z'), rawResponseId: 'raw-3', status: 'Cancelled' },
  ], []);
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ metric: 'revenue', value: '30' }),
    expect.objectContaining({ metric: 'orders', value: '2' }),
    expect.objectContaining({ metric: 'units', value: '3' }),
  ]));
});

it('clears every affected date even when recomputation yields no daily fact rows', async () => {
  const deleted: string[] = [];
  const inserted: unknown[] = [];
  await replaceDailyFactRows(['2026-01-01'], [], async (day) => { deleted.push(day); }, async (row) => { inserted.push(row); });
  expect(deleted).toEqual(['2026-01-01']);
  expect(inserted).toEqual([]);
});
