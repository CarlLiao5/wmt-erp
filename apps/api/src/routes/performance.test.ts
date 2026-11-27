import { expect, it, vi } from 'vitest';

it('calculates acos and roas', async () => {
  const { marketingMetrics } = await import('./performance.js');
  expect(marketingMetrics(200, 50)).toEqual({ acos: 0.25, roas: 4 });
});

it('loads performance rows before closing the database pool', async () => {
  vi.resetModules();
  const state = { closed: false };
  vi.doMock('@walmart-erp/db', () => ({
    performanceSnapshots: { tenantId: 'tenantId', storeId: 'storeId', periodEnd: 'periodEnd' },
    createDb: () => ({
      db: { select: () => ({ from: () => ({ where: async () => { await Promise.resolve(); if (state.closed) throw new Error('Pool is closed'); return [{ metric: '30DAY.ots' }]; } }) }) },
      pool: { end: async () => { state.closed = true; } },
    }),
    and: (...conditions: unknown[]) => conditions,
    eq: (field: unknown, value: unknown) => [field, value],
    gte: (field: unknown, value: unknown) => [field, value],
    lte: (field: unknown, value: unknown) => [field, value],
  }));
  const { mysqlPerformanceSource } = await import('./performance.js');
  const rows = await mysqlPerformanceSource()('tenant-1');
  expect(rows).toEqual([{ metric: '30DAY.ots' }]);
});
