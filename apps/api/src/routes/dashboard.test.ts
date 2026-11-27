import express from 'express';
import { describe, expect, it } from 'vitest';
import { dashboardOverview, formatFactDate, todayPacificDate, orderFallbackRows, withinDateRange, dedupeFactRows, dedupeSemPerformanceRows, stockoutRisk, dashboardRouter, mergeDailySalesRows } from './dashboard.js';

describe('dashboardOverview', () => {
  it('summarizes metrics, preserves estimates, and reports latest freshness', () => {
    const result = dashboardOverview([
      { date: '2026-10-01', revenue: 100, orders: 2, units: 3, refunds: 4, profit: null, estimated: true, refreshedAt: '2026-10-01T01:00:00Z' },
      { date: '2026-10-02', revenue: 50, orders: 1, units: 2, refunds: 0, profit: 10, refreshedAt: '2026-10-02T01:00:00Z' },
    ], '2026-10-02');
    expect(result.metrics).toMatchObject({ revenue: 50, orders: 1, units: 2, refunds: 0, profit: 10, estimated: false });
    expect(result.freshness).toBe('2026-10-02T01:00:00Z');
  });

  it('uses Pacific local date for the current-day KPI', () => {
    expect(todayPacificDate(new Date('2026-10-06T07:00:00Z'))).toBe('2026-10-06');
    expect(dashboardOverview([{ date: '2026-10-05', revenue: 100, orders: 2, units: 3 }], '2026-10-06').metrics.revenue).toBe(0);
  });

  it('summarizes the selected date range instead of today when date filters are applied', () => {
    const result = dashboardOverview([
      { date: '2026-09-21', revenue: 416.41, orders: 14, units: 14 },
      { date: '2026-09-22', revenue: 622.62, orders: 21, units: 22 },
    ], '2026-10-20', true);
    expect(result.metrics).toMatchObject({ revenue: 1039.03, orders: 35, units: 36 });
    expect(result.trend.map((row) => row.date)).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('formats database date values as calendar dates instead of local timestamp strings', () => {
    expect(formatFactDate(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05');
    expect(formatFactDate('2026-10-05')).toBe('2026-10-05');
  });

  it('builds missing daily rows from persisted orders without duplicating order totals', () => {
    expect(orderFallbackRows([
      { id: 'o1', orderedAt: new Date('2026-10-06T16:00:00.000Z'), totalAmount: '100', status: 'Acknowledged' },
      { id: 'o2', orderedAt: new Date('2026-10-06T17:00:00.000Z'), totalAmount: '50', status: 'Shipped' },
    ], [
      { orderId: 'o1', quantity: '2' },
      { orderId: 'o1', quantity: '1' },
      { orderId: 'o2', quantity: '4' },
    ], '2026-10-06')).toEqual([{ date: '2026-10-06', revenue: 150, orders: 2, units: 7, refunds: 0, profit: null, estimated: true }]);
  });

  it('includes every non-cancelled status in fallback rows', () => {
    expect(orderFallbackRows([
      { id: 'ack', orderedAt: '2026-10-06T16:00:00.000Z', totalAmount: '100', status: 'Acknowledged' },
      { id: 'ship', orderedAt: '2026-10-06T17:00:00.000Z', totalAmount: '50', status: 'Shipped' },
      { id: 'cancel', orderedAt: '2026-10-06T18:00:00.000Z', totalAmount: '90', status: 'Cancelled' },
    ], [])).toEqual([{ date: '2026-10-06', revenue: 150, orders: 2, units: 0, refunds: 0, profit: null, estimated: true }]);
  });
});

describe('dashboard helpers', () => {
  it('replaces incomplete revenue facts with the daily non-cancelled order-line aggregate', () => {
    const result = mergeDailySalesRows([
      { date: '2026-11-08', revenue: 0, orders: 362, units: 449, refunds: 0, profit: null, estimated: true },
    ], [
      { date: '2026-11-08', revenue: 15032.81, orders: 364, units: 451 },
    ]);

    expect(result).toEqual([
      { date: '2026-11-08', revenue: 15032.81, orders: 364, units: 451, refunds: 0, profit: null, estimated: true },
    ]);
  });

  it('keeps order fallback rows inside the selected date range', () => {
    const rows = orderFallbackRows([
      { id: 'before', orderedAt: new Date('2026-09-20T18:00:00.000Z'), totalAmount: '10', status: 'Shipped' },
      { id: 'selected', orderedAt: new Date('2026-09-21T18:00:00.000Z'), totalAmount: '20', status: 'Delivered' },
      { id: 'after', orderedAt: new Date('2026-09-22T18:00:00.000Z'), totalAmount: '30', status: 'Acknowledged' },
    ], []);
    expect(withinDateRange(rows, { from: '2026-09-21', to: '2026-09-21' })).toEqual([{ date: '2026-09-21', revenue: 20, orders: 1, units: 0, refunds: 0, profit: null, estimated: true }]);
  });
  it('deduplicates daily facts by keeping the latest value for a metric', () => {
    expect(dedupeFactRows([
      { storeId: 's', date: '2026-10-02', metric: 'revenue', value: 49.86 },
      { storeId: 's', date: '2026-10-02', metric: 'revenue', value: 362.9 },
    ])).toEqual([{ storeId: 's', date: '2026-10-02', metric: 'revenue', value: 362.9 }]);
  });
  it('keeps only the latest SEM spend batch per store, date, campaign, and SKU', () => {
    const rows = [
      { storeId: 'store-1', factDate: '2026-11-01', campaignId: 'campaign-1', sku: 'SKU-1', spend: 100, receivedAt: '2026-11-02T00:00:00Z' },
      { storeId: 'store-1', factDate: '2026-11-01', campaignId: 'campaign-1', sku: 'SKU-1', spend: 20, receivedAt: '2026-11-03T00:00:00Z' },
      { storeId: 'store-1', factDate: '2026-11-01', campaignId: 'campaign-2', sku: 'SKU-1', spend: 5, receivedAt: '2026-11-03T00:00:00Z' },
    ];
    expect(dedupeSemPerformanceRows(rows).map((row) => row.spend)).toEqual([20, 5]);
  });
  it('calculates stockout risk from 30 day velocity', () => {
    expect(stockoutRisk([{ sku: 'A', title: 'A', inventory: 20, units30d: 30 }])).toEqual([{ sku: 'A', title: 'A', inventory: 20, units30d: 30, daysLeft: 20 }]);
  });
});

it('rejects an unauthenticated dashboard request with the standard 401 envelope', async () => {
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = 'dashboard-test'; next(); });
  app.use(dashboardRouter(async () => [], undefined, async () => undefined));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/dashboard`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ requestId: 'dashboard-test', data: null, error: { message: 'Authenticated visibility scope required' } });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects a reversed date range before loading dashboard data', async () => {
  let loaded = false;
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = 'dashboard-range-test'; next(); });
  app.use(dashboardRouter(async () => { loaded = true; return []; }));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/dashboard/overview?from=2026-10-22&to=2026-10-21`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ requestId: 'dashboard-range-test', data: null, error: { message: '开始日期不能晚于结束日期' } });
    expect(loaded).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('loads overview rows and dashboard extras concurrently', async () => {
  let listFinished = false;
  let extrasStartedBeforeListFinished = false;
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = 'dashboard-parallel-test'; next(); });
  app.use(dashboardRouter(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    listFinished = true;
    return [];
  }, async () => {
    extrasStartedBeforeListFinished = !listFinished;
    return { stores: [], stockoutRisk: [], adSpend: { today: null, month: null, trend: [] }, highAcos: [] };
  }));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/dashboard/overview`);
    expect(response.status).toBe(200);
    expect(extrasStartedBeforeListFinished).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { mergeSnapshotProfit } from './dashboard-profit.js';

it('plots seller return deductions on the Pacific return date, including loss-only days', () => {
  const rows = [{date:'2026-11-01', revenue:100, orders:1, units:1}];
  expect(mergeSnapshotProfit(rows, [
    {timestamp:'2026-11-02T06:30:00Z', amount:'25', incomplete:1},
    {timestamp:'2026-11-02T08:30:00Z', amount:'-10', incomplete:0},
  ], '2026-11-01', '2026-11-02')).toMatchObject([
    {date:'2026-11-01', profit:25, estimated:true},
    {date:'2026-11-02', profit:-10, estimated:false},
  ]);
});
