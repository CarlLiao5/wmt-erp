import { expect, it } from 'vitest';
import { orderMetrics } from './orders.js';
it('calculates order line metrics', () => expect(orderMetrics([{ orderId: 'o1', storeId: 's', sku: 'a', quantity: 2, amount: 10 }, { orderId: 'o1', storeId: 's', sku: 'b', quantity: 1, amount: 5 }])).toEqual({ orders: 1, units: 3, revenue: 15 }));
