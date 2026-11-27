import { expect, it } from 'vitest';
import { aggregateOrderSalesBySku, normalizeReturnReason, pacificDateRangeBounds, projectCommerceRows, projectOrderChartRows } from './commerce-source.js';

it('aggregates non-cancelled order units by sku without treating missing quantities as zero', () => {
  expect(aggregateOrderSalesBySku([
    { orderId: 'o1', storeId: 's', sku: 'A', itemId: '100', quantity: 2, amount: 12, status: 'Acknowledged' },
    { orderId: 'o2', storeId: 's', sku: 'A', itemId: '100', quantity: 3, amount: 18, status: 'Shipped' },
    { orderId: 'o3', storeId: 's', sku: 'A', itemId: '100', quantity: 100, amount: 600, status: 'Cancelled' },
    { orderId: 'o4', storeId: 's', sku: 'B', itemId: '200', quantity: null, amount: null, status: 'Created' },
  ])).toEqual([
    { storeId: 's', sku: 'A', itemId: '100', units: 5, orders: 2, revenue: 30 },
    { storeId: 's', sku: 'B', itemId: '200', units: null, orders: 1, revenue: null },
  ]);
});

it('normalizes return reason variants to one display category', () => {
  expect(normalizeReturnReason('NO_LONGER_WANTED', 'No Longer Wanted')).toEqual({ key: 'NO_LONGER_WANTED', label: 'No Longer Wanted' });
  expect(normalizeReturnReason(undefined, 'NO_LONGER_WANTED')).toEqual({ key: 'NO_LONGER_WANTED', label: 'No Longer Wanted' });
  expect(normalizeReturnReason('DEFECTIVE', 'Defective/Broken')).toEqual({ key: 'DEFECTIVE', label: 'Defective/Broken' });
});

it('builds Pacific calendar-day UTC bounds with the correct daylight-saving offsets', () => {
  expect(pacificDateRangeBounds('2026-03-08', '2026-03-08').map((date) => date.toISOString())).toEqual([
    '2026-03-08T08:00:00.000Z',
    '2026-03-09T07:00:00.000Z',
  ]);
  expect(pacificDateRangeBounds('2026-11-01', '2026-11-01').map((date) => date.toISOString())).toEqual([
    '2026-11-01T07:00:00.000Z',
    '2026-11-02T08:00:00.000Z',
  ]);
});

it('projects combined order chart rows into Pacific, China, and region series', () => {
  const charts = projectOrderChartRows([
    { kind: 'daily', bucket: '2026-11-03', count: 4 },
    { kind: 'pacific_hour', bucket: 18, count: 3 },
    { kind: 'china_hour', bucket: 2, count: 3 },
    { kind: 'region', bucket: 'California', count: 2 },
  ]);
  expect(charts.dailyOrderTrend).toEqual([{ date: '2026-11-03', count: 4 }]);
  expect(charts.hourlyOrderTrend).toHaveLength(24);
  expect(charts.hourlyOrderTrend[18]).toEqual({ hour: 18, count: 3 });
  expect(charts.chinaHourlyOrderTrend[2]).toEqual({ hour: 2, count: 3 });
  expect(charts.regionDistribution).toEqual([{ region: 'California', count: 2 }]);
});

it('projects replayed raw pages into one current line and append-only status history', () => {
  const rows = [
    { id: '1', externalId: 'raw-order-1', tenantId: 't', storeId: 's', resource: 'orders', payload: { orders: [{ purchaseOrderId: 'o1', orderDate: '2026-01-01', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] } },
    { id: '2', externalId: 'raw-order-2', tenantId: 't', storeId: 's', resource: 'orders', payload: { orders: [{ purchaseOrderId: 'o1', orderDate: '2026-01-01', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] } },
    { id: '3', tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REQUESTED', refundAmount: { amount: 0 } }] }] } },
    { id: '4', tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REQUESTED', refundAmount: { amount: 0 } }] }] } },
    { id: '5', tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REFUNDED', refundAmount: { amount: 5 } }] }] } }
  ];
  const projection = projectCommerceRows(rows);
  expect(projection.orders.map((line) => ({ id: line.id, rawResponseId: line.rawResponseId }))).toEqual([{ id: 's:o1:1', rawResponseId: 'raw-order-2' }]);
  expect(projection.returns).toMatchObject([{ id: 's:r1:1', orderId: 's:o1', status: 'REFUNDED', amount: 5 }]);
  expect(projection.snapshots.map((snapshot) => snapshot.status)).toEqual(['REQUESTED', 'REFUNDED']);
  expect(projection.snapshots.map((snapshot) => snapshot.rawResponseId)).toEqual(['3', '5']);
});

it('retains a later repeated status after an intervening transition', () => {
  const rows = ['REQUESTED', 'REFUNDED', 'REQUESTED'].map((status, index) => ({ id: String(index + 1), tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r', purchaseOrderId: 'o', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status, refundAmount: { amount: 0 } }] }] } }));
  expect(projectCommerceRows(rows).snapshots.map((snapshot) => snapshot.status)).toEqual(['REQUESTED', 'REFUNDED', 'REQUESTED']);
});
