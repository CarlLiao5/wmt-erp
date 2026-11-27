import { expect, it } from 'vitest';
import { dailySalesFacts, dailyFactRows, salesDateInPacificTime } from './aggregates.js';

it('uses Pacific local dates with automatic daylight-saving transitions', () => {
  expect(salesDateInPacificTime('2026-07-04T06:59:59Z')).toBe('2026-07-03');
  expect(salesDateInPacificTime('2026-07-04T07:00:00Z')).toBe('2026-07-04');
  expect(salesDateInPacificTime('2026-12-04T07:59:59Z')).toBe('2026-12-03');
  expect(salesDateInPacificTime('2026-12-04T08:00:00Z')).toBe('2026-12-04');
});

it('aggregates visible order and refund lines without double counting orders', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', quantity: 2, amount: 12, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }, { id: 'b', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'B', quantity: 1, amount: 7, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }], [{ id: 'r', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-02', rawResponseId: 'raw-2' }]);
    expect(facts).toEqual([{ tenantId: 't', storeId: 's', date: '2026-01-02', orders: 1, units: 3, revenue: 19, refunds: 5, returns: 1, returnRate: 5 / 19, rawResponseIds: ['raw-1', 'raw-2'] }]);
});

it('counts all order statuses except cancelled orders', () => {
  const facts = dailySalesFacts([
    { id: 'a', tenantId: 't', storeId: 's', orderId: 'ack', sku: 'A', quantity: 1, amount: 10, orderedAt: '2026-01-02', rawResponseId: 'raw-1', status: 'Acknowledged' },
    { id: 'b', tenantId: 't', storeId: 's', orderId: 'ship', sku: 'A', quantity: 2, amount: 20, orderedAt: '2026-01-02', rawResponseId: 'raw-2', status: 'Shipped' },
    { id: 'c', tenantId: 't', storeId: 's', orderId: 'cancel', sku: 'A', quantity: 9, amount: 90, orderedAt: '2026-01-02', rawResponseId: 'raw-3', status: 'Cancelled' },
    { id: 'd', tenantId: 't', storeId: 's', orderId: 'cancel-variant', sku: 'A', quantity: 8, amount: 80, orderedAt: '2026-01-02', rawResponseId: 'raw-4', status: 'canceled' },
  ], []);

  expect(facts[0]).toMatchObject({ orders: 2, units: 3, revenue: 30 });
});

it('counts one returned order when multiple lines are refunded', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', quantity: 2, amount: 12, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }], [{ id: 'r1', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-02', rawResponseId: 'raw-2' }, { id: 'r2', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'B', amount: 3, status: 'REFUNDED', returnedAt: '2026-01-02', rawResponseId: 'raw-2' }]);
  expect(facts[0]).toMatchObject({ orders: 1, returns: 1, refunds: 5, returnRate: 5 / 12 });
});

it('attributes a return to its original order-day cohort', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 's:o1', sku: 'A', quantity: 1, amount: 10, orderedAt: '2026-01-02', rawResponseId: 'raw-order' }], [{ id: 'r', tenantId: 't', storeId: 's', orderId: 's:o1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-04', rawResponseId: 'raw-return' }]);
    expect(facts).toEqual([{ tenantId: 't', storeId: 's', date: '2026-01-02', orders: 1, units: 1, revenue: 10, refunds: 5, returns: 1, returnRate: 0.5, rawResponseIds: ['raw-order', 'raw-return'] }]);
});

it('excludes returns whose order is outside the supplied cohort', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 's:o1', sku: 'A', quantity: 1, amount: 10, orderedAt: '2026-01-02', rawResponseId: 'raw-order' }], [{ id: 'r', tenantId: 't', storeId: 's', orderId: 's:o2', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-04', rawResponseId: 'raw-return' }]);
  expect(facts).toEqual([{ tenantId: 't', storeId: 's', date: '2026-01-02', orders: 1, units: 1, revenue: 10, refunds: 0, returns: 0, returnRate: 0, rawResponseIds: ['raw-order'] }]);
});

it('maps facts to dashboard rows', () => {
  const rows = dailyFactRows(dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', quantity: 2, amount: 12, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }], []));
  expect(rows.map(({ metric, value }) => ({ metric, value }))).toEqual([{ metric: 'revenue', value: '12' }, { metric: 'orders', value: '1' }, { metric: 'units', value: '2' }, { metric: 'refunds', value: '0' }]);
});

it('does not emit fabricated zero sales or units when every source value is missing', () => {
  const rows = dailyFactRows(dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', orderedAt: '2026-01-02', rawResponseId: 'raw-1' }], []));
  expect(rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ metric: 'revenue', value: '0' }), expect.objectContaining({ metric: 'units', value: '0' })]));
});
