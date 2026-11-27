import { describe, expect, it } from 'vitest';
import { buildCommerceDailyFacts } from './rebuild-commerce-daily-facts';

describe('buildCommerceDailyFacts', () => {
  it('keeps refunds on a Pacific day with no sales rows', () => {
    const rows = buildCommerceDailyFacts({
      tenantId: 'tenant',
      storeId: 'store',
      sales: [{ day: '2026-11-01', orders: '2', units: '3', revenue: '30.00' }],
      refunds: [
        { day: '2026-11-01', refunds: '4.00' },
        { day: '2026-11-02', refunds: '5.00' },
      ],
    });

    expect(rows).toEqual([
      ['store:2026-11-01:revenue', 'tenant', 'store', '2026-11-01', 'revenue', '30.00', 'USD'],
      ['store:2026-11-01:orders', 'tenant', 'store', '2026-11-01', 'orders', '2', null],
      ['store:2026-11-01:units', 'tenant', 'store', '2026-11-01', 'units', '3', null],
      ['store:2026-11-01:refunds', 'tenant', 'store', '2026-11-01', 'refunds', '4.00', 'USD'],
      ['store:2026-11-02:refunds', 'tenant', 'store', '2026-11-02', 'refunds', '5.00', 'USD'],
    ]);
  });

  it('uses a sales query that excludes only cancelled statuses', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const source = fs.readFileSync(new URL('./rebuild-commerce-daily-facts.ts', import.meta.url), 'utf8');
    expect(source).toContain("UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED')");
  });
});
