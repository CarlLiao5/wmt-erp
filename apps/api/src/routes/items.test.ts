import { describe, expect, it } from 'vitest';
import { filterVisibleItems } from './items.js';
describe('item visibility', () => { const items = [{ id: '1', storeId: 's1', sku: 'a' }, { id: '2', storeId: 's2', sku: 'b' }]; it('shows all to admin', () => expect(filterVisibleItems(items, { role: 'admin', storeIds: new Set(), skus: new Set() })).toHaveLength(2)); it('filters members by store or sku', () => expect(filterVisibleItems(items, { role: 'member', storeIds: new Set(['s1']), skus: new Set(['z']) })).toEqual([items[0]])); });
