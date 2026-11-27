import { describe, expect, it } from 'vitest';
import { canonicalStoreName, mapLegacyItemOnlyOrder, planLegacyCommerceRows } from './backfill-commerce-legacy.js';

describe('legacy commerce backfill planning', () => {
  it('maps the corrected Xin Qi Dian alias and keeps incomplete rows as anomalies', () => {
    const plan = planLegacyCommerceRows({
      stores: [{ id: '10002512034', name: '鑫启典沃尔玛' }],
      orders: [{ id: 1, store_name: '鑫起典沃尔玛', purchase_order_id: 'PO-1', order_status: 'Delivered' }],
      items: [
        { id: 2, store_name: '鑫起典沃尔玛', purchase_order_id: 'PO-1', line_number: '1', sku: 'SKU-1', quantity: 1 },
        { id: 3, store_name: '鑫起典沃尔玛', purchase_order_id: 'PO-MISSING', line_number: '1', sku: 'SKU-2', quantity: 1 },
      ],
      returns: [{ id: 4, store_name: '鑫起典沃尔玛', return_order_id: 'RET-1', sku: null, quantity: 1 }],
    });
    expect(plan.counts).toEqual({ orders: 1, items: 2, returns: 1, missingParentItems: 1, missingSkuReturns: 1 });
    expect(plan.anomalies.map((row) => row.kind)).toEqual(['missing_parent_order', 'missing_sku']);
    expect(plan.orders[0].store_name).toBe('鑫启典沃尔玛');
    expect(plan.items[0].store_name).toBe('鑫启典沃尔玛');
    expect(plan.returns[0].store_name).toBe('鑫启典沃尔玛');
    expect(canonicalStoreName('10002512034', [{ id: '10002512034', name: '鑫启典沃尔玛' }])).toBe('鑫启典沃尔玛');
  });

  it('does not invent an order date for legacy item rows missing a parent order', () => {
    const parent = mapLegacyItemOnlyOrder({ storeId: '10002512034', tenantId: 'default', storeName: '鑫启典沃尔玛', purchaseOrderId: 'PO-ORPHAN', item: { created_at: '2026-08-01 10:00:00', item_status: 'Shipped', unit_price: '20.00' } });
    expect(parent.orderedAt).toBeNull();
    expect(parent.sourceApi).toBe('legacy_item_only');
    expect(parent.status).toBe('LEGACY_PARTIAL');
  });
});
