import { describe, expect, it } from 'vitest';
import { normalizeItemPayload, upsertNormalizedItems } from './syncItems.js';
describe('item normalization', () => {
  it('normalizes Walmart item envelopes with stable store identity', () => {
    const rows = normalizeItemPayload({ items: [{ sku: ' A-1 ', productName: 'Widget', itemId: 'i1' }] }, { storeId: 'store-a', tenantId: 'tenant-a', now: new Date('2026-01-01') });
    expect(rows[0]).toMatchObject({ storeId: 'store-a', tenantId: 'tenant-a', sku: 'A-1', title: 'Widget', itemId: 'i1' });
  });
  it('upserts every normalized row and is rerunnable', async () => { const saved: string[] = []; const item = normalizeItemPayload([{ sku: 'A' }], { storeId: 's' }); await upsertNormalizedItems(item, async (row) => { if (!saved.includes(row.sku)) saved.push(row.sku); }); await upsertNormalizedItems(item, async (row) => { if (!saved.includes(row.sku)) saved.push(row.sku); }); expect(saved).toEqual(['A']); });
});
