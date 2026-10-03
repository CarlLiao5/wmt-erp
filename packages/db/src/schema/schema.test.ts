import { describe, expect, it } from 'vitest';
import { inventorySnapshots, orders, rawPayloads, skus, syncJobs } from './index.js';

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
  });
});
