import { describe, expect, it } from 'vitest';
import { filterAssignedItems, filterVisibleItems, itemIdFromSources, itemReportFields, itemReportItemId, itemResponseRecord } from './items.js';
import { buildAllSkuChineseNameMap, buildCatalogSkuMatcher } from './allskuOwnerMapping.js';

describe('ALLSKU Chinese product names', () => {
  it('maps 品名 by the matching store and normalized SKU', () => {
    const result = buildAllSkuChineseNameMap(
      [{ payload: { values: { 店铺: [{ text: '亿辰沃尔玛' }], SKU: [{ text: ' sku-a ' }], 品名: [{ text: '中文商品名' }] } } }],
      [{ id: 'store-1', name: '亿辰沃尔玛' }, { id: 'store-2', name: '另一店铺' }],
    );

    expect(result.get('store-1:SKU-A')).toBe('中文商品名');
    expect(result.has('store-2:SKU-A')).toBe(false);
  });

  it('does not map ambiguous duplicate store and SKU rows', () => {
    const result = buildAllSkuChineseNameMap(
      [
        { payload: { values: { 店铺: '亿辰沃尔玛', SKU: 'SKU-A', 品名: '名称一' } } },
        { payload: { values: { 店铺: '亿辰沃尔玛', SKU: 'SKU-A', 品名: '名称二' } } },
      ],
      [{ id: 'store-1', name: '亿辰沃尔玛' }],
    );

    expect(result.has('store-1:SKU-A')).toBe(false);
  });
});

describe('item visibility', () => { const items = [{ id: '1', storeId: 's1', sku: 'a' }, { id: '2', storeId: 's2', sku: 'b' }]; it('shows all to admin', () => expect(filterVisibleItems(items, { role: 'admin', storeIds: new Set(), skus: new Set() })).toHaveLength(2)); it('filters members by store or sku', () => expect(filterVisibleItems(items, { role: 'member', storeIds: new Set(['s1']), skus: new Set(['z']) })).toEqual([items[0]])); });

describe('assigned item catalog', () => {
  it('only keeps products with a resolved owner', () => {
    expect(filterAssignedItems([{ id: '1', storeId: 's1', sku: 'a', ownerName: 'Miya' }, { id: '2', storeId: 's1', sku: 'b', ownerName: null }])).toEqual([{ id: '1', storeId: 's1', sku: 'a', ownerName: 'Miya' }]);
  });
});

describe('catalog SKU lookup', () => {
  it('matches a normalized SKU only within its store and rejects duplicate catalog matches', () => {
    const find = buildCatalogSkuMatcher([
      { id: 'one', storeId: 'store-a', externalId: ' sku-1 ' },
      { id: 'two', storeId: 'store-b', externalId: 'SKU-1' },
      { id: 'duplicate-a', storeId: 'store-a', externalId: 'SKU-2' },
      { id: 'duplicate-b', storeId: 'store-a', externalId: ' sku-2 ' },
    ]);

    expect(find('store-a', 'SKU-1')?.id).toBe('one');
    expect(find('store-b', 'sku-1')?.id).toBe('two');
    expect(find('store-a', 'sku-2')).toBeUndefined();
  });
});

describe('Item report fields', () => {
  it('reads nonempty report fields from the merged item details without changing the API shape for older rows', () => {
    expect(itemReportFields({ itemReport: { SKU: 'A-1', Price: '12.50', Empty: '', Ignore: null } })).toEqual({ SKU: 'A-1', Price: '12.50' });
    expect(itemReportFields({ sourceItem: { SKU: 'A-1' } })).toBeUndefined();
  });

  it('does not return the raw details JSON after projecting its display fields', () => {
    expect(itemResponseRecord({ id: '1', storeId: 's1', sku: 'A-1', details: { largeRawResponse: 'unused' }, reportFields: { Brand: 'Acme' }, imageUrl: 'https://example.test/image.jpg' })).toEqual({ id: '1', storeId: 's1', sku: 'A-1', reportFields: { Brand: 'Acme' }, imageUrl: 'https://example.test/image.jpg' });
  });

  it('falls back to an Item ID already present in the saved Walmart report', () => {
    expect(itemReportItemId({ itemReport: { 'Item ID': '17001160680' } })).toBe('17001160680');
    expect(itemReportItemId({ itemReport: { 'Item Id': '12345' } })).toBe('12345');
    expect(itemReportItemId({ itemReport: { SKU: 'A-1' } })).toBeUndefined();
  });

  it('falls back when the standard Item ID column is empty but preserves a populated value', () => {
    const details = { itemReport: { 'Item ID': '17001160680' } };
    expect(itemIdFromSources('', details)).toBe('17001160680');
    expect(itemIdFromSources('  ', details)).toBe('17001160680');
    expect(itemIdFromSources('12345', details)).toBe('12345');
  });
});
