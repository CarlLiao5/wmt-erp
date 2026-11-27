import { expect, it } from 'vitest';
import { orderCharts, orderMetrics, pacificOrderTime } from './orders.js';
it('calculates order line metrics', () => expect(orderMetrics([{ orderId: 'o1', storeId: 's', sku: 'a', quantity: 2, amount: 10 }, { orderId: 'o1', storeId: 's', sku: 'b', quantity: 1, amount: 5 }])).toEqual({ orders: 1, units: 3, revenue: 15 }));

it('counts all non-cancelled statuses in order metrics', () => expect(orderMetrics([
  { orderId: 'ack', storeId: 's', sku: 'a', quantity: 1, amount: 10, status: 'Acknowledged' },
  { orderId: 'ship', storeId: 's', sku: 'a', quantity: 2, amount: 20, status: 'Shipped' },
  { orderId: 'cancel', storeId: 's', sku: 'a', quantity: 8, amount: 80, status: 'Cancelled' },
])).toEqual({ orders: 2, units: 3, revenue: 30 }));

it('keeps date-only order values on their stated Pacific business date', () => {
  expect(pacificOrderTime('2026-01-02')).toEqual({ date: '2026-01-02', hour: 0 });
});

it('groups order chart days by Pacific time across the daylight-saving transition', () => {
  const chart = orderCharts([
    { orderId: 'before-midnight', storeId: 's', sku: 'a', quantity: 1, amount: 1, orderedAt: '2026-11-01T06:59:59.000Z' },
    { orderId: 'before-midnight', storeId: 's', sku: 'b', quantity: 2, amount: 2, orderedAt: '2026-11-01T06:59:59.000Z' },
    { orderId: 'after-midnight', storeId: 's', sku: 'a', quantity: 1, amount: 1, orderedAt: '2026-11-01T07:00:00.000Z' },
    { orderId: 'after-fallback', storeId: 's', sku: 'a', quantity: 1, amount: 1, orderedAt: '2026-11-01T08:00:00.000Z' },
  ]);

  expect(chart.dailyOrderTrend).toEqual([
    { date: '2026-10-31', count: 1 },
    { date: '2026-11-01', count: 2 },
  ]);
  expect(chart.hourlyOrderTrend.filter((row) => row.count)).toEqual([
    { hour: 0, count: 1 },
    { hour: 1, count: 1 },
    { hour: 23, count: 1 },
  ]);
  expect(chart.chinaHourlyOrderTrend.filter((row) => row.count)).toEqual([
    { hour: 14, count: 1 },
    { hour: 15, count: 1 },
    { hour: 16, count: 1 },
  ]);
});

it('keeps cancelled orders browseable but excludes them from sales charts', () => {
  const chart = orderCharts([
    { orderId: 'active', storeId: 's', sku: 'a', orderedAt: '2026-11-01T07:00:00.000Z', status: 'Acknowledged' },
    { orderId: 'cancelled', storeId: 's', sku: 'a', orderedAt: '2026-11-01T08:00:00.000Z', status: 'Cancelled' },
  ]);
  expect(chart.dailyOrderTrend).toEqual([{ date: '2026-11-01', count: 1 }]);
});
