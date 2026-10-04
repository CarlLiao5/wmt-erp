import { expect, it } from 'vitest';
import { dailySalesFacts } from './aggregates.js';

it('aggregates visible order and refund lines without double counting orders', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', quantity: 2, amount: 12, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }, { id: 'b', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'B', quantity: 1, amount: 7, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }], [{ id: 'r', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-02', rawResponseId: 'raw-2' }]);
  expect(facts).toEqual([{ tenantId: 't', storeId: 's', date: '2026-01-02', orders: 1, units: 3, revenue: 19, refunds: 5, returns: 1, returnRate: 1, rawResponseIds: ['raw-1', 'raw-2'] }]);
});

it('counts one returned order when multiple lines are refunded', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', quantity: 2, amount: 12, orderedAt: '2026-01-02', rawResponseId: 'raw-1' }], [{ id: 'r1', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-02', rawResponseId: 'raw-2' }, { id: 'r2', tenantId: 't', storeId: 's', orderId: 'o1', sku: 'B', amount: 3, status: 'REFUNDED', returnedAt: '2026-01-02', rawResponseId: 'raw-2' }]);
  expect(facts[0]).toMatchObject({ orders: 1, returns: 1, refunds: 5, returnRate: 1 });
});

it('attributes a return to its original order-day cohort', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 's:o1', sku: 'A', quantity: 1, amount: 10, orderedAt: '2026-01-02', rawResponseId: 'raw-order' }], [{ id: 'r', tenantId: 't', storeId: 's', orderId: 's:o1', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-04', rawResponseId: 'raw-return' }]);
  expect(facts).toEqual([{ tenantId: 't', storeId: 's', date: '2026-01-02', orders: 1, units: 1, revenue: 10, refunds: 5, returns: 1, returnRate: 1, rawResponseIds: ['raw-order', 'raw-return'] }]);
});

it('excludes returns whose order is outside the supplied cohort', () => {
  const facts = dailySalesFacts([{ id: 'a', tenantId: 't', storeId: 's', orderId: 's:o1', sku: 'A', quantity: 1, amount: 10, orderedAt: '2026-01-02', rawResponseId: 'raw-order' }], [{ id: 'r', tenantId: 't', storeId: 's', orderId: 's:o2', sku: 'A', amount: 5, status: 'REFUNDED', returnedAt: '2026-01-04', rawResponseId: 'raw-return' }]);
  expect(facts).toEqual([{ tenantId: 't', storeId: 's', date: '2026-01-02', orders: 1, units: 1, revenue: 10, refunds: 0, returns: 0, returnRate: 0, rawResponseIds: ['raw-order'] }]);
});
