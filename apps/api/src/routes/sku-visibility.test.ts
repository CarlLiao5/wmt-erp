import { describe, expect, it } from 'vitest';
import { canViewStoreSku, filterVisibleSkuRows } from './sku-visibility.js';

const member = { role: 'member' as const, storeIds: new Set<string>(), skus: new Set(['store-a:SKU-1']) };

describe('SKU visibility', () => {
  it('matches a SKU grant by store and case-insensitive SKU', () => {
    expect(canViewStoreSku(member, 'store-a', 'sku-1')).toBe(true);
    expect(canViewStoreSku(member, 'store-b', 'SKU-1')).toBe(false);
  });

  it('preserves an explicit store grant and administrator visibility', () => {
    const storeMember = { ...member, storeIds: new Set(['store-b']) };
    expect(canViewStoreSku(storeMember, 'store-b', 'UNASSIGNED')).toBe(true);
    expect(canViewStoreSku({ ...member, role: 'admin' }, 'store-b', 'UNASSIGNED')).toBe(true);
  });

  it('filters all rows when visibility is missing and uses exact store plus SKU for members', () => {
    const rows = [
      { storeId: 'store-a', sku: 'SKU-1' },
      { storeId: 'store-b', sku: 'SKU-1' },
      { storeId: 'store-a', sku: 'SKU-2' },
    ];
    expect(filterVisibleSkuRows(rows, member)).toEqual([rows[0]]);
    expect(filterVisibleSkuRows(rows, undefined)).toEqual([]);
  });
});
