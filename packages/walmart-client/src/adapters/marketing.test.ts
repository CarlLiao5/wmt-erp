import { describe, expect, it } from 'vitest';
import { getPricingInsights, getPromotionalPrices, normalizePerformanceRows, normalizePriceIncentiveRows, normalizePriceRows, normalizePricingInsightRows, normalizePromotionalPriceRows } from './pricing.js';
import { normalizeAdvertisingRows } from './advertising.js';
import { getSemPerformanceSummary, normalizeSemRows } from './sem.js';
import { listPerformance, normalizeSellerPerformanceRows } from './performance.js';

describe('marketing adapters', () => {
  it('normalizes price rows without inventing missing values', () => {
    expect(normalizePriceRows({ items: [{ sku: 'A', price: 12.5, currency: 'USD', effectiveAt: '2026-10-08' }] })).toEqual([{ sku: 'A', price: 12.5, currency: 'USD', effectiveAt: '2026-10-08', source: 'walmart' }]);
  });
  it('normalizes confirmed price incentive fields', () => {
    const [row] = normalizePriceIncentiveRows({ items: [{ itemId: 'I1', skuId: 'S1', currentPrice: 10, targetPrice: 8, incentiveStatus: 'ELIGIBLE', startDate: '1790985600000', expirationDate: '1792281599000' }] });
    expect(row).toMatchObject({ sku: 'S1', startDate: '2026-10-03T00:00:00.000Z', endDate: '2026-10-17T23:59:59.000Z' });
  });
  it('uses the confirmed pricing insights read-only POST', async () => {
    const fetcher = (async (input: URL, init?: RequestInit) => { expect(input.pathname).toBe('/v3/price/getPricingInsights'); expect(init?.method).toBe('POST'); expect(JSON.parse(String(init?.body)).pageNumber).toBe(0); return new Response(JSON.stringify({ pricingInsightsResponseList: [{ sku: 'S1', currentPrice: 10, suggestedPrice: 9 }] }), { status: 200 }); }) as typeof fetch;
    const response = await getPricingInsights({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, {}, fetcher);
    expect(normalizePricingInsightRows(response.data)[0]?.targetPrice).toBe(9);
  });
  it('uses the confirmed promotional price SKU path', async () => {
    const fetcher = (async (input: URL) => { expect(input.pathname).toBe('/v3/promo/sku/S1'); return new Response(JSON.stringify({ items: [{ sku: 'S1', promotionalPrice: 7, startDate: '2026-10-01' }] }), { status: 200 }); }) as typeof fetch;
    const payload = await getPromotionalPrices({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, 'S1', fetcher);
    expect(normalizePromotionalPriceRows(payload, 'S1')[0]?.price).toBe(7);
  });
  it('normalizes Walmart promotional pricingList response', () => {
    const rows = normalizePromotionalPriceRows({ status: 'OK', payload: { itemIdentifier: { sku: 'S1' }, pricingList: { pricing: [{ promoId: 'p1', currentPrice: { value: { amount: 7.5, currency: 'USD' } }, comparisonPrice: { value: { amount: 9.99 } }, effectiveDate: 1789032600000, expirationDate: 1796864400000 }] } } });
    expect(rows[0]).toMatchObject({ sku: 'S1', price: 7.5, targetPrice: 9.99, promotion: 'p1', priceType: 'promotion' });
  });

  it('prefers the explicit promotion type, including Flash Deal', () => {
    const rows = normalizePromotionalPriceRows({ payload: { pricingList: { pricing: [{ sku: 'S1', promotionalPrice: 7, promotionType: 'FLASH_DEAL', currentPriceType: 'BASE' }] } } });
    expect(rows[0].promotionType).toBe('FLASH_DEAL');
  });
  it('normalizes pricing insight comparison and buy box fields', async () => {
    const mod = await import('./pricing.js');
    const rows = mod.normalizePricingInsightRows({ pricingInsightsResponseList: [{ sku: 'S1', currentPrice: 10, buyBoxBasePrice: 9, buyBoxTotalPrice: 9.5, comparisonPrice: 12, competitorPrice: 11, promoStatus: 'ACTIVE', priceDisplayCodes: { isStrikethrough: true } }] });
    expect(rows[0]).toMatchObject({ buyBoxBasePrice: 9, buyBoxTotalPrice: 9.5, comparisonPrice: 12, competitorPrice: 11, promotionType: 'ACTIVE', showStrikethrough: true });
  });
  it('marks advertising attribution incomplete and leaves ratios null', async () => {
    const mod = await import('./advertising.js');
    expect(mod.normalizeAdvertisingRows({ rows: [{ date: '2026-10-08', spend: 5, attributedSales: null }] })).toEqual([{ factDate: '2026-10-08', campaignId: undefined, spend: 5, attributedSales: null, attributedUnits: null, impressions: null, clicks: null, complete: false, acos: null, roas: null, channel: 'onsite' }]);
  });
  it('normalizes performance period fields', () => {
    expect(normalizePerformanceRows({ metrics: [{ metric: 'buyBox', value: 0.8, periodStart: '2026-10-01', periodEnd: '2026-10-08' }] })).toEqual([{ metric: 'buyBox', value: 0.8, periodStart: '2026-10-01', periodEnd: '2026-10-08', complete: true }]);
  });
  it('normalizes the seller performance report rolling windows', () => {
    expect(normalizeSellerPerformanceRows({ payload: { '30DAY': { ots: 99.5, refundRateSellerFault: 1.2 } } })).toEqual([
      { metric: '30DAY.ots', value: 99.5, complete: true },
      { metric: '30DAY.refundRateSellerFault', value: 1.2, complete: true },
    ]);
  });
  it('reads the official seller performance report endpoint', async () => {
    const fetcher = (async (input: URL, init?: RequestInit) => {
      expect(input.pathname).toBe('/v3/report/payment/performance');
      expect(init?.method ?? 'GET').toBe('GET');
      return new Response(JSON.stringify({ payload: { '7DAY': { ots: 100 } } }), { status: 200 });
    }) as typeof fetch;
    const payloads: unknown[] = [];
    for await (const payload of listPerformance({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, {}, fetcher)) payloads.push(payload);
    expect(payloads).toHaveLength(1);
  });
  it('normalizes SEM campaign performance into sem advertising rows', () => {
    expect(normalizeSemRows({ data: [{ campaignId: 'c1', startDate: '2026-10-01', traffic: { adspend: 12.5, gmv: 100, impressions: 1000, clicks: 50, roas: 8 } }] })).toEqual([{ factDate: '2026-10-01', campaignId: 'c1', spend: 12.5, attributedSales: 100, attributedUnits: null, impressions: 1000, clicks: 50, complete: true, acos: 0.125, roas: 8, channel: 'sem' }]);
  });
  it('uses the approved SEM report query POST', async () => {
    const calls: Array<{ method?: string; path: string }> = [];
    const fetcher = (async (input: URL, init?: RequestInit) => { calls.push({ method: init?.method, path: input.pathname }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }) as typeof fetch;
    await getSemPerformanceSummary({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, { page: { offset: 0, limit: 200 } }, fetcher);
    expect(calls).toEqual([{ method: 'POST', path: '/v3/advertising/sem/campaigns/performance-summary' }]);
  });
});
