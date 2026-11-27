import { describe, expect, it } from 'vitest';
import { deterministicId, mapItemNameRow, mapProductInventoryRow, mapRunHistoryRow, parseLegacyShanghaiDate, selectCanonicalItemNameRows, validateSourceRows } from './migrate-brightdata-legacy.js';

describe('Bright Data legacy migration mapping', () => {
  it('maps item names and preserves legacy rows', () => {
    const record = mapItemNameRow({ id: 12, 'Item id': 'ITEM-1', store_id: null, item_name: 'Widget' }, 'tenant-1');
    expect(record.tenantId).toBe('tenant-1');
    expect(record.itemId).toBe('ITEM-1');
    expect(record.storeId).toBeNull();
    expect(record.sourceRowId).toBe('12');
    expect(record.rawPayload.item_name).toBe('Widget');
    expect(record.id).toBe(deterministicId('brightdata-item-name', '12'));
  });

  it('maps WBKC item name columns and keeps category in the raw payload', () => {
    const record = mapItemNameRow({ id: 12, 'Item ID': ' 19403101729 ', Name: 'Widget', Category: 'Sports', scrape_status: 'success' }, 'default');
    expect(record.itemId).toBe('19403101729');
    expect(record.productName).toBe('Widget');
    expect(record.rawPayload.Category).toBe('Sports');
    expect(record.rawPayload.scrape_status).toBe('success');
  });

  it('selects the newest WBKC item record for duplicate Item IDs deterministically', () => {
    const rows = [
      { id: 'old', 'Item ID': '19403101729', Name: 'Old name', created_at: '2026-01-01 09:00:00' },
      { id: 'new', 'Item ID': '19403101729', Name: 'New name', created_at: '2026-02-01 09:00:00' },
    ];
    expect(selectCanonicalItemNameRows(rows).map((row) => row.Name)).toEqual(['New name']);
    expect(selectCanonicalItemNameRows([...rows].reverse()).map((row) => row.Name)).toEqual(['New name']);
  });

  it('keeps unknown inventory quantities as NULL and maps aliases', () => {
    const record = mapProductInventoryRow({ id: 'r1', 'Item id': 'ITEM-1', Time: '2026-10-01T07:00:00Z', availableQuantity: null, reviewCount: 4 }, 'tenant-1');
    expect(record.itemId).toBe('ITEM-1');
    expect(record.availableQuantity).toBeNull();
    expect(record.reviewCount).toBe(4);
    expect(record.queriedAt.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(record.idempotencyKey).toBe('legacy:product_inventory:r1');
  });

  it('parses the three legacy time formats as China-local timestamps', () => {
    expect(parseLegacyShanghaiDate('2026-10-01 08:15:30', 'Time').toISOString()).toBe('2026-10-01T00:15:30.000Z');
    expect(parseLegacyShanghaiDate('2026/10/2', 'Time').toISOString()).toBe('2026-10-01T16:00:00.000Z');
    expect(parseLegacyShanghaiDate('2026-10-3 23:59:59', 'Time').toISOString()).toBe('2026-10-03T15:59:59.000Z');
  });

  it('does not turn failed inventory scrapes into zero stock', () => {
    const record = mapProductInventoryRow({ id: 'r2', 'Item ID': '19403101729', 'PRODUCT NAME': '抓取失败', availableQuantity: 12, Time: '2026/10/2' }, 'default');
    expect(record.productName).toBe('抓取失败');
    expect(record.availableQuantity).toBeNull();
    expect(record.queriedAt.toISOString()).toBe('2026-10-01T16:00:00.000Z');
  });

  it('maps run history and normalizes oversized run IDs deterministically', () => {
    const runId = 'a'.repeat(80);
    const record = mapRunHistoryRow({ run_id: runId, started_at: '2026-10-01T07:00:00Z', ended_at: null, total: 2, success: 1, failed: 1, status: 'completed_with_errors' }, 'tenant-1');
    expect(record.runId).toBe(deterministicId('brightdata-run', runId));
    expect(record.totalItems).toBe(2);
    expect(record.failCount).toBe(1);
    expect(record.endedAt).toBeNull();
  });

  it('validates distinct item IDs and inventory time range', () => {
    const result = validateSourceRows({
      itemNames: [{ item_id: 'ITEM-1' }, { item_id: 'ITEM-1' }, { item_id: 'ITEM-2' }],
      productInventory: [{ item_id: 'ITEM-1', queried_at: '2026-10-02' }, { item_id: 'ITEM-2', queried_at: '2026-10-01' }],
      runHistory: [],
    });
    expect(result.itemIdCount).toBe(2);
    expect(result.inventoryTimeRange).toEqual({ min: '2026-09-30T16:00:00.000Z', max: '2026-10-01T16:00:00.000Z' });
  });

  it('fails validation for missing required fields', () => {
    expect(() => mapItemNameRow({ id: 'r1' }, 'tenant-1')).toThrow(/no item_id/);
    expect(() => mapProductInventoryRow({ id: 'r1', item_id: 'ITEM-1' }, 'tenant-1')).toThrow(/no queried_at/);
    expect(() => mapRunHistoryRow({ run_id: 'r1' }, 'tenant-1')).toThrow(/no started_at/);
  });
});
