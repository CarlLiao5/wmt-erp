import { describe, expect, it } from 'vitest';
import { advertisingMetrics, dedupeSemAdvertisingFacts, mysqlTextEquals, onsiteDateExpression } from './advertising.js';

describe('marketing API metrics', () => {
  it('compares advertising text columns under one explicit collation', () => {
    expect(mysqlTextEquals('k.external_id', 'm.sku')).toBe('k.external_id COLLATE utf8mb4_unicode_ci = m.sku COLLATE utf8mb4_unicode_ci');
  });

  it('uses the placement table date column for onsite placement reports', () => {
    expect(onsiteDateExpression('onsite-placement')).toBe('a.date');
  });

  it('keeps ACOS and ROAS null when attribution is missing', () => {
    expect(advertisingMetrics([{ spend: '10', attributedSales: null, complete: 0 }])).toMatchObject({ spend: 10, attributedSales: null, acos: null, roas: null, complete: false });
  });
  it('calculates ratios after rows are scoped', () => {
    expect(advertisingMetrics([{ spend: '10', attributedSales: '50', complete: 1 }])).toMatchObject({ acos: 0.2, roas: 5, complete: true });
  });
  it('keeps only the newest SEM batch for each store, date, and campaign', () => {
    const rows = [
      { storeId: 'store-1', factDate: new Date('2026-03-07'), campaignId: 'camp-1', receivedAt: new Date('2026-10-31T08:00:00Z'), spend: '100' },
      { storeId: 'store-1', factDate: new Date('2026-03-07'), campaignId: 'camp-1', receivedAt: new Date('2026-11-01T08:00:00Z'), spend: '120' },
      { storeId: 'store-1', factDate: new Date('2026-03-07'), campaignId: 'camp-2', receivedAt: new Date('2026-11-01T08:00:00Z'), spend: '80' },
    ];
    expect(dedupeSemAdvertisingFacts(rows)).toHaveLength(2);
    expect(dedupeSemAdvertisingFacts(rows).map((row) => row.spend)).toEqual(expect.arrayContaining(['120', '80']));
  });
});
