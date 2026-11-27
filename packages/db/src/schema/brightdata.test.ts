import { describe, expect, it } from 'vitest';
import {
  brightdataItemNames,
  brightdataProductInventory,
  brightdataRunHistory,
  brightdataSyncSchedules,
} from './brightdata.js';

describe('Bright Data schema contracts', () => {
  it('defines the independent Bright Data table names and legacy column mappings', () => {
    expect(brightdataItemNames).toBeDefined();
    expect(brightdataProductInventory).toBeDefined();
    expect(brightdataRunHistory).toBeDefined();
    expect(brightdataItemNames.itemId.name).toBe('item_id');
    expect(brightdataItemNames.sourceRowId.name).toBe('source_row_id');
    expect(brightdataProductInventory.availableQuantity.name).toBe('available_quantity');
    expect(brightdataProductInventory.queriedAt.name).toBe('queried_at');
    expect(brightdataRunHistory.totalItems.name).toBe('total_items');
    expect(brightdataRunHistory.successCount.name).toBe('success_count');
    expect(brightdataRunHistory.failCount.name).toBe('fail_count');
    expect(brightdataSyncSchedules.nextRunAt.name).toBe('next_run_at');
    expect(brightdataSyncSchedules.lastRunAt.name).toBe('last_run_at');
  });

  it('keeps item identity unique per tenant and allows an unmatched store', () => {
    expect(brightdataItemNames.storeId.notNull).toBe(false);
    expect(brightdataItemNames.itemId.notNull).toBe(true);
    expect(brightdataItemNames.tenantId.notNull).toBe(true);
  });

  it('preserves unknown inventory as NULL and exposes snapshot/idempotency fields', () => {
    expect(brightdataProductInventory.availableQuantity.notNull).toBe(false);
    expect(brightdataProductInventory.sourceItemId.notNull).toBe(false);
    expect(brightdataProductInventory.runId.notNull).toBe(true);
    expect(brightdataProductInventory.idempotencyKey.notNull).toBe(true);
    expect(brightdataProductInventory.createdAt.notNull).toBe(true);
  });

  it('stores run status and error details with tenant scope', () => {
    expect(brightdataRunHistory.runId.notNull).toBe(true);
    expect(brightdataRunHistory.status.notNull).toBe(true);
    expect(brightdataRunHistory.startedAt.notNull).toBe(true);
    expect(brightdataRunHistory.endedAt.notNull).toBe(false);
    expect(brightdataRunHistory.errorMessage.notNull).toBe(false);
  });
});
