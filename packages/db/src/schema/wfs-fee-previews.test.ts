import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { wfsFeePreviewItems, wfsFeePreviewOptions, wfsFeePreviewRuns } from './index.js';

describe('WFS fee preview schema', () => {
  it('definesTenantStoreShipmentRunIdentity', () => {
    expect(wfsFeePreviewRuns.tenantId.name).toBe('tenant_id');
    expect(wfsFeePreviewRuns.storeId.name).toBe('store_id');
    expect(wfsFeePreviewRuns.shipmentId.name).toBe('shipment_id');
    expect(wfsFeePreviewRuns.lastAttemptAt.name).toBe('last_attempt_at');
    expect(wfsFeePreviewRuns.lastSuccessAt.name).toBe('last_success_at');
    const config = getTableConfig(wfsFeePreviewRuns);
    expect(config.uniqueConstraints.find((constraint) => constraint.name === 'wfs_fee_preview_run_identity_unique')?.columns.map((column) => column.name)).toEqual(['tenant_id', 'store_id', 'shipment_id']);
    expect(config.indexes.map((entry) => entry.config.name)).toContain('wfs_fee_preview_run_scope_idx');
  });

  it('indexesOptionsByShipmentAndDestination', () => {
    expect(wfsFeePreviewOptions.previewType.name).toBe('preview_type');
    expect(wfsFeePreviewOptions.shipNode.name).toBe('ship_node');
    const config = getTableConfig(wfsFeePreviewOptions);
    expect(config.uniqueConstraints.find((constraint) => constraint.name === 'wfs_fee_preview_option_identity_unique')?.columns.map((column) => column.name)).toEqual(['tenant_id', 'store_id', 'shipment_id', 'preview_type', 'ship_node']);
    expect(config.indexes.map((entry) => entry.config.name)).toContain('wfs_fee_preview_options_scope_idx');
  });

  it('storesPerSkuFeesAsNullableDecimals', () => {
    expect(wfsFeePreviewOptions.totalNetTransferCharge.columnType).toBe('MySqlDecimal');
    expect(wfsFeePreviewItems.netTransferCharge.columnType).toBe('MySqlDecimal');
    expect(wfsFeePreviewItems.netTransferCharge.notNull).toBe(false);
    expect(wfsFeePreviewItems.sku.name).toBe('sku');
    const config = getTableConfig(wfsFeePreviewItems);
    expect(config.uniqueConstraints.find((constraint) => constraint.name === 'wfs_fee_preview_item_product_unique')?.columns.map((column) => column.name)).toEqual(['option_id', 'product_identity']);
    expect(config.indexes.map((entry) => entry.config.name)).toContain('wfs_fee_preview_items_scope_idx');
  });
});
