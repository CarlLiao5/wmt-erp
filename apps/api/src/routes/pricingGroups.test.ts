import { describe, expect, it } from 'vitest';
import { filterAndSortPricing, filterPricingByType, paginatePricing } from './pricingGroups.js';

describe('filterAndSortPricing', () => {
  const rows = [
    { storeId: 's', sku: 'no-promo', promotionPrice: null, promotionStart: null, promotionEnd: null, showStrikethrough: null },
    { storeId: 's', sku: 'ends-late', promotionPrice: '8', promotionEnd: '2026-12-20 08:00:00.000', showStrikethrough: 1 },
    { storeId: 's', sku: 'ends-soon', promotionPrice: '9', promotionEnd: '2026-11-29 08:00:00.000', showStrikethrough: 0 },
    { storeId: 's', sku: 'ends-mid', promotionPrice: '7', promotionEnd: '2026-12-02 08:00:00.000', showStrikethrough: 1 },
  ];
  const skus = (list: Array<{ sku: string }>) => list.map((row) => row.sku);

  it('sorts by promotion end date, soonest first, and keeps rows without an end date last', () => {
    expect(skus(filterAndSortPricing(rows))).toEqual(['ends-soon', 'ends-mid', 'ends-late', 'no-promo']);
  });

  it('filters on whether a promotion exists', () => {
    expect(skus(filterAndSortPricing(rows, 'yes'))).toEqual(['ends-soon', 'ends-mid', 'ends-late']);
    expect(skus(filterAndSortPricing(rows, 'no'))).toEqual(['no-promo']);
    expect(skus(filterAndSortPricing(rows, 'all'))).toHaveLength(4);
  });

  it('filters on the strikethrough flag and keeps unknown separate', () => {
    expect(skus(filterAndSortPricing(rows, undefined, 'yes'))).toEqual(['ends-mid', 'ends-late']);
    expect(skus(filterAndSortPricing(rows, undefined, 'no'))).toEqual(['ends-soon']);
    expect(skus(filterAndSortPricing(rows, undefined, 'unknown'))).toEqual(['no-promo']);
  });

  it('sorts by store then sku when end dates tie', () => {
    const tied = [
      { storeId: 'b', sku: 'A', promotionEnd: '2026-12-01' },
      { storeId: 'a', sku: 'B', promotionEnd: '2026-12-01' },
      { storeId: 'a', sku: 'A', promotionEnd: '2026-12-01' },
    ];
    expect(filterAndSortPricing(tied).map((row) => `${row.storeId}:${row.sku}`)).toEqual(['a:A', 'a:B', 'b:A']);
  });

  it('filters before pagination so page totals match the filter', () => {
    const filtered = filterAndSortPricing(rows, 'yes');
    expect(paginatePricing(filtered, 1, 2)).toMatchObject({ total: 3, pages: 2, rows: [expect.objectContaining({ sku: 'ends-soon' }), expect.objectContaining({ sku: 'ends-mid' })] });
  });
});

describe('filterPricingByType', () => {
  const rows = [
    { sku: 'base-only', promotionPrice: null, incentiveType: null },
    { sku: 'promo', promotionPrice: '9.99', incentiveType: null },
    { sku: 'incentive', promotionPrice: null, incentiveType: 'REDUCED_REFERRAL' },
  ];
  it('keeps only rows that carry the selected price type', () => {
    expect(filterPricingByType(rows, 'promotion').map((row) => row.sku)).toEqual(['promo']);
    expect(filterPricingByType(rows, 'incentive').map((row) => row.sku)).toEqual(['incentive']);
    expect(filterPricingByType(rows, 'base')).toHaveLength(3);
    expect(filterPricingByType(rows, undefined)).toHaveLength(3);
  });
});

describe('paginatePricing', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i);
  it('returns one bounded page with totals', () => {
    expect(paginatePricing(rows, 2, 20)).toEqual({ rows: rows.slice(20, 40), page: 2, pageSize: 20, pages: 3, total: 45 });
  });
  it('clamps bad page and page size input', () => {
    expect(paginatePricing(rows, 99, 20).page).toBe(3);
    expect(paginatePricing(rows, 0, 20).page).toBe(1);
    expect(paginatePricing(rows, 'x', 'y')).toMatchObject({ page: 1, pageSize: 20 });
    expect(paginatePricing(rows, 1, 100000).pageSize).toBe(100);
  });
  it('handles an empty list', () => {
    expect(paginatePricing([], 1, 20)).toEqual({ rows: [], page: 1, pageSize: 20, pages: 1, total: 0 });
  });
});
