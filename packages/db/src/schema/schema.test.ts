import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { inventorySnapshots, orderLines, orders, rawPayloads, reconTransactions, returnRecords, returnStatusEvents, skus, skuTargetRows, syncJobs, targetBatches, weatherSnapshots, wfsFeePreviewItems, wfsFeePreviewOptions, wfsFeePreviewRuns, wfsInventoryLogs } from './index.js';

describe('MySQL schema contracts', () => {
  it('defines tenant/store external identity and historical snapshot columns', () => {
    expect(orders.externalId.name).toBe('external_id');
    expect(orders.tenantId.name).toBe('tenant_id');
    expect(orders.storeId.name).toBe('store_id');
    expect(inventorySnapshots.occurredAt.name).toBe('occurred_at');
    expect(rawPayloads.payload.name).toBe('payload');
  });

  it('defines decimal money and idempotent job columns', () => {
    expect(orders.totalAmount.columnType).toBe('MySqlDecimal');
    expect(skus.externalId.name).toBe('external_id');
    expect(syncJobs.idempotencyKey.name).toBe('idempotency_key');
    expect(syncJobs.completedAt.name).toBe('completed_at');
  });

  it('defines monthly SKU target batch and calculation columns', () => {
    expect(targetBatches.tenantId.name).toBe('tenant_id');
    expect(targetBatches.formulaVersion.name).toBe('formula_version');
    expect(targetBatches.status.name).toBe('status');
    expect(skuTargetRows.batchId.name).toBe('batch_id');
    expect(skuTargetRows.storeId.name).toBe('store_id');
    expect(skuTargetRows.expectedDailySales.columnType).toBe('MySqlDecimal');
    expect(skuTargetRows.quantityTarget.columnType).toBe('MySqlDecimal');
    expect(skuTargetRows.amountTarget.columnType).toBe('MySqlDecimal');
    expect(skuTargetRows.missingReasons.name).toBe('missing_reasons');
  });

  it('preserves the legacy commerce fields in normalized tables', () => {
    expect(orders.customerOrderId.name).toBe('customer_order_id');
    expect(orders.estimatedDeliveryAt.name).toBe('estimated_delivery_at');
    expect(orders.postalCode.name).toBe('postal_code');
    expect(orders.state.name).toBe('state');
    expect(orders.orderedAt.notNull).toBe(false);
    expect(orders.fulfillmentOption.name).toBe('fulfillment_option');
    expect(orderLines.lineNumber.name).toBe('line_number');
    expect(orderLines.upc.name).toBe('upc');
    expect(orderLines.productName.name).toBe('product_name');
    expect(orderLines.shippingCharge.name).toBe('shipping_charge');
    expect(returnRecords.sku.notNull).toBe(false);
    expect(returnRecords.quantity.name).toBe('quantity');
    expect(returnRecords.reasonCode.name).toBe('reason_code');
    expect(returnRecords.refundStatus.name).toBe('refund_status');
  });

  it('stores return status history with a stable store-scoped identity', () => {
    expect(returnStatusEvents.tenantId.name).toBe('tenant_id');
    expect(returnStatusEvents.storeId.name).toBe('store_id');
    expect(returnStatusEvents.returnId.name).toBe('return_id');
    expect(returnStatusEvents.sourceIdentity.name).toBe('source_identity');
    expect(returnStatusEvents.status.name).toBe('status');
    expect(returnStatusEvents.rawResponseId.name).toBe('raw_response_id');
    const config = getTableConfig(returnStatusEvents);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain('return_status_event_source_unique');
    expect(config.indexes.map((index) => index.config.name)).toContain('return_status_event_scope_idx');
  });

  it('indexes latest raw batches and shipment-scoped WFS logs', () => {
    expect(getTableConfig(rawPayloads).indexes.map((index) => index.config.name)).toContain('raw_payload_resource_store_time_idx');
    expect(getTableConfig(wfsInventoryLogs).indexes.map((index) => index.config.name)).toContain('wfs_inventory_logs_shipment_idx');
    expect(getTableConfig(wfsInventoryLogs).indexes.map((index) => index.config.name)).toContain('wfs_inventory_logs_receipt_cover_idx');
    expect(getTableConfig(orders).indexes.map((index) => index.config.name)).toContain('orders_tenant_ordered_id_idx');
    expect(getTableConfig(weatherSnapshots).indexes.map((index) => index.config.name)).toContain('weather_snapshots_state_latest_idx');
  });

  it('exports WFS fee preview tables from the shared schema', () => {
    expect(wfsFeePreviewRuns.shipmentId.name).toBe('shipment_id');
    expect(wfsFeePreviewOptions.shipNode.name).toBe('ship_node');
    expect(wfsFeePreviewItems.optionId.name).toBe('option_id');
  });

  it('defines indexed transaction attributes for normalized Recon rows', () => {
    expect(reconTransactions.reportMonth.name).toBe('report_month');
    expect(reconTransactions.sourceId.name).toBe('source_id');
    expect(reconTransactions.transactionKey.name).toBe('transaction_key');
    expect(reconTransactions.transactionKey.notNull).toBe(true);
    expect(reconTransactions.rowNumber.name).toBe('row_number');
    expect(reconTransactions.transactionDate.name).toBe('transaction_date');
    expect(reconTransactions.periodStartDate.name).toBe('period_start_date');
    expect(reconTransactions.periodEndDate.name).toBe('period_end_date');
    expect(reconTransactions.description.name).toBe('description');
    expect(reconTransactions.amount.columnType).toBe('MySqlDecimal');
    expect(reconTransactions.currency.name).toBe('currency');
    const config = getTableConfig(reconTransactions);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain('recon_transaction_source_key_unique');
    expect(config.uniqueConstraints.find((constraint) => constraint.name === 'recon_transaction_source_key_unique')?.columns.map((column) => column.name)).toEqual(['tenant_id', 'store_id', 'source_id', 'transaction_key']);
    expect(config.indexes.map((index) => index.config.name)).toContain('recon_transaction_type_idx');
  });
});
