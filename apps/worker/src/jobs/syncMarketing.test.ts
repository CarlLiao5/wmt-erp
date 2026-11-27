import { describe, expect, it } from 'vitest';
import { processSyncRequest } from '../queue.js';
import { loadPromotionalPricesForSkus, normalizeStoredPriceIncentivePayload, semSearchTermId, waitForSemReport } from './syncMarketing.js';

describe('marketing sync dispatch', () => {
  it('keeps successful promotion payloads and reports failed SKUs without retrying them', async () => {
    const attempted: string[] = [];
    const failures: string[] = [];
    const results = await loadPromotionalPricesForSkus(['SKU-1', 'SKU-2'], async (sku) => {
      attempted.push(sku);
      if (sku === 'SKU-2') throw new Error('upstream unavailable');
      return { price: 10 };
    }, (sku, error) => failures.push(`${sku}: ${(error as Error).message}`));
    expect(attempted).toEqual(['SKU-1', 'SKU-2']);
    expect(results).toEqual([{ sku: 'SKU-1', payload: { price: 10 } }]);
    expect(failures).toEqual(['SKU-2: upstream unavailable']);
  });

  it('checks SEM report status immediately when the create response is still pending', async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const result = await waitForSemReport('request-1', async (id) => { calls.push(id); return { requestStatus: 'READY' }; }, async (milliseconds) => { waits.push(milliseconds); }, { requestStatus: 'RECEIVED' });
    expect(calls).toEqual(['request-1']);
    expect(waits).toEqual([]);
    expect(result.status).toBe('READY');
  });

  it('uses a stable identity for the same SEM search-term report row across imports', () => {
    const row = { reportDate: '2026-10-15', campaignId: 'c1', searchTerm: '  Kids   Boxing ', sku: 'sku-1', itemId: 'i1' };
    expect(semSearchTermId('tenant-1', 'store-1', row)).toBe(semSearchTermId('tenant-1', 'store-1', { ...row, searchTerm: 'kids boxing' }));
    expect(semSearchTermId('tenant-1', 'store-1', row)).not.toBe(semSearchTermId('tenant-1', 'store-1', { ...row, campaignId: 'c2' }));
  });

  it('normalizes stored incentive payloads for idempotent backfill', () => {
    const [row] = normalizeStoredPriceIncentivePayload(JSON.stringify({ skuId: 'S1', currentPrice: 10, targetPrice: 8, incentiveId: 'I1', startDate: '1790985600000' }));
    expect(row).toMatchObject({ sku: 'S1', priceType: 'incentive', incentiveId: 'I1', startDate: '2026-10-03T00:00:00.000Z' });
  });

  it('accepts pricing, advertising, and performance resources', async () => {
    const seen: string[] = [];
    const connection = async () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.test' });
    const original = process.env.MYSQL_URL;
    delete process.env.MYSQL_URL;
    try {
      for (const resource of ['pricing', 'advertising', 'performance']) {
        await expect(processSyncRequest({ tenantId: 't', storeId: 's', resource, window: { from: '2026-10-01', to: '2026-10-08' } }, connection, { orders: async () => { seen.push('orders'); }, returns: async () => { seen.push('returns'); } } as any)).rejects.toThrow(/MYSQL_URL|fetch failed|Walmart request/);
      }
      expect(seen).toEqual([]);
    } finally { if (original) process.env.MYSQL_URL = original; }
  });
});
