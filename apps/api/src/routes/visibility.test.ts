import { expect, it } from 'vitest';
import { filterVisibleOrderLines } from './orders.js';
it('filters order lines by member scope', () => expect(filterVisibleOrderLines([{ orderId: '1', storeId: 'a', sku: 'x', quantity: 1, amount: 2 }, { orderId: '2', storeId: 'b', sku: 'y', quantity: 1, amount: 3 }], { role: 'member', storeIds: new Set(['a']), skus: new Set() })).toHaveLength(1));
