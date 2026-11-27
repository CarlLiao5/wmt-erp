import express from 'express';
import { describe, expect, it } from 'vitest';
import { productAnalysisRouter } from './product-analysis.js';

const visibility = async () => ({ tenantId: 't1', role: 'member' as const, storeIds: new Set(['s1']), skus: new Set<string>() });
const catalog = [
  { id: 'a', storeId: 's1', sku: 'SKU-A', itemId: 'I-A', productName: 'Alpha', imageUrl: 'a.jpg' },
  { id: 'b', storeId: 's2', sku: 'SKU-A', itemId: 'I-B', productName: 'Other', imageUrl: 'b.jpg' },
];

async function request(router: express.Router, path: string) {
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
  app.use('/api', router);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  try { return await fetch(`http://127.0.0.1:${address.port}${path}`); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

describe('product analysis routes', () => {
  it('searches only authorized products by SKU, name, or item id', async () => {
    const response = await request(productAnalysisRouter({ visibility, products: async () => catalog }), '/api/product-analysis/products?q=SKU-A');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([catalog[0]]);
  });

  it('searches item ids stored in the item report details fallback', async () => {
    const response = await request(productAnalysisRouter({ visibility, products: async () => [
      { ...catalog[0], itemId: null, details: { itemReport: { 'Item ID': '16482065710' } } },
    ] }), '/api/product-analysis/products?q=16482065710');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ ...catalog[0], itemId: '16482065710' }]);
  });

  it('uses the fallback Item ID when requesting the onsite keyword cloud', async () => {
    const onsiteTerms = async (_tenantId: string, _storeId: string, _from: string, _to: string, itemId: string) => {
      expect(itemId).toBe('16482065710');
      return [{ storeId: 's1', itemId, reportDate: '2026-01-01', searchTerm: 'raised toilet seat', impressions: 30, spend: 4, sales: 12 }];
    };
    const router = productAnalysisRouter({ visibility, products: async () => [
      { ...catalog[0], itemId: null, details: { itemReport: { 'Item ID': '16482065710' } } },
    ], orders: async () => [], returns: async () => [], onsiteTerms });
    const response = await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-01-01&to=2026-01-01');
    expect((await response.json()).data.onsiteTerms).toEqual([{ term: 'raised toilet seat', count: 30, spend: 4, sales: 12 }]);
  });

  it('aggregates scoped orders, returns, ads and terms into daily trends', async () => {
    const router = productAnalysisRouter({ visibility, products: async () => catalog,
      orders: async () => [{ tenantId: 't1', orderId: 'o1', storeId: 's1', sku: 'SKU-A', quantity: 2, amount: 20, orderedAt: '2026-10-01' }],
      returns: async () => [
        { tenantId: 't1', id: 'r1', orderId: 'o1', storeId: 's1', sku: 'SKU-A', amount: 5, status: 'REFUNDED', reason: 'Damaged', refundCoveredBy: 'Seller', returnedAt: '2026-10-01' },
        { tenantId: 't1', id: 'r2', orderId: 'o2', storeId: 's1', sku: 'SKU-A', amount: 6, status: 'REFUNDED', reason: 'Carrier damage', refundCoveredBy: 'Walmart', returnedAt: '2026-10-01' },
        { tenantId: 't1', id: 'r3', orderId: 'o3', storeId: 's1', sku: 'SKU-A', amount: 7, status: 'REFUNDED', reason: 'Not provided', returnedAt: '2026-10-01' },
      ],
      ads: async () => [{ storeId: 's1', sku: 'SKU-A', factDate: '2026-10-01', channel: 'onsite', spend: 2 }],
      semTerms: async () => [{ storeId: 's1', sku: 'SKU-A', reportDate: '2026-10-01', searchTerm: 'alpha', adSpend: 1 }],
    });
    const response = await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-10-01&to=2026-10-01');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ metrics: { sales: 20, units: 2, returns: 3, sellerReturnedOrderCount: 1, returnRate: 1, onsiteSpend: 2 }, salesTrend: [{ date: '2026-10-01', sales: 20, units: 2 }], returnReasons: [{ reason: 'Damaged', count: 1 }], responsibilityDistribution: [{ responsibility: '卖家责任', count: 1 }, { responsibility: 'WFS责任', count: 1 }, { responsibility: '其他/未提供', count: 1 }], semTerms: [{ term: 'alpha', count: 1, spend: 1, sales: 0 }] });
  });

  it('groups return reason codes with their equivalent descriptions', async () => {
    const router = productAnalysisRouter({ visibility, products: async () => [catalog[0]], orders: async () => [], ads: async () => [],
      returns: async () => [
        { tenantId: 't1', id: 'r1', orderId: 'o1', storeId: 's1', sku: 'SKU-A', status: 'REFUNDED', reason: 'NO_LONGER_WANTED', refundCoveredBy: 'Seller', returnedAt: '2026-10-01' },
        { tenantId: 't1', id: 'r2', orderId: 'o2', storeId: 's1', sku: 'SKU-A', status: 'REFUNDED', reason: 'No Longer Wanted', reasonCode: 'NO_LONGER_WANTED', refundCoveredBy: 'Walmart', returnedAt: '2026-10-01' },
        { tenantId: 't1', id: 'r3', orderId: 'o3', storeId: 's1', sku: 'SKU-A', status: 'REFUNDED', reason: 'DEFECTIVE', refundCoveredBy: 'Seller Keep-It', returnedAt: '2026-10-01' },
        { tenantId: 't1', id: 'r4', orderId: 'o4', storeId: 's1', sku: 'SKU-A', status: 'REFUNDED', reason: 'Defective/Broken', reasonCode: 'DEFECTIVE', refundCoveredBy: 'Walmart Keep-It', returnedAt: '2026-10-01' },
      ],
    });
    const response = await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-10-01&to=2026-10-01');
    const data = (await response.json()).data;
    expect(data.returnReasons).toEqual([
      { reason: 'Defective/Broken', count: 1 },
      { reason: 'No Longer Wanted', count: 1 },
    ]);
    expect(data.responsibilityDistribution).toEqual([
      { responsibility: '卖家责任', count: 2 },
      { responsibility: 'WFS责任', count: 2 },
    ]);
  });

  it('builds the onsite keyword cloud from matching ad_keyword_report rows', async () => {
    const router = productAnalysisRouter({ visibility, products: async () => [catalog[0]], orders: async () => [], returns: async () => [],
      onsiteTerms: async (_tenantId, storeId, from, to, itemId) => {
        expect([storeId, from, to, itemId]).toEqual(['s1', '2026-10-01', '2026-10-01', 'I-A']);
        return [
          { storeId: 's1', itemId: 'I-A', reportDate: '2026-10-01', searchTerm: 'waterproof gloves', impressions: 120, spend: 2, sales: 5 },
          { storeId: 's1', itemId: 'I-A', reportDate: '2026-10-01', searchTerm: 'waterproof gloves', impressions: 80, spend: 1, sales: 3 },
          { storeId: 's1', itemId: 'I-A', reportDate: '2026-10-02', searchTerm: 'outside date', impressions: 999, spend: 9, sales: 9 },
          { storeId: 's2', itemId: 'I-B', reportDate: '2026-10-01', searchTerm: 'other item', impressions: 999, spend: 9, sales: 9 },
        ];
      },
    });
    const response = await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-10-01&to=2026-10-01');
    expect((await response.json()).data.onsiteTerms).toEqual([{ term: 'waterproof gloves', count: 200, spend: 3, sales: 8 }]);
  });

  it('uses SKU-scoped SEM search-term spend for the ad trend', async () => {
    const router = productAnalysisRouter({ visibility, products: async () => [catalog[0]], orders: async () => [], returns: async () => [],
      ads: async () => [{ storeId: 's1', sku: 'SKU-A', factDate: '2026-10-01', channel: 'onsite', spend: 2 }],
      semTerms: async () => [{ storeId: 's1', sku: 'SKU-A', reportDate: '2026-10-01', searchTerm: 'alpha', adSpend: 7 }],
    });
    const response = await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-10-01&to=2026-10-01');
    expect((await response.json()).data.adSpendTrend).toEqual([{ date: '2026-10-01', onsiteSpend: 2, semSpend: 7, totalSpend: 9 }]);
  });

  it('rejects reversed ranges and returns null ratios with empty dimensions', async () => {
    const router = productAnalysisRouter({ visibility, products: async () => [catalog[0]], orders: async () => [], returns: async () => [] });
    expect((await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-10-02&to=2026-10-01')).status).toBe(400);
    const response = await request(router, '/api/product-analysis?sku=SKU-A&storeId=s1&from=2026-10-01&to=2026-10-01');
    expect((await response.json()).data).toMatchObject({ metrics: { sales: 0, onsiteSalesRatio: null, semSalesRatio: null, totalSalesRatio: null }, returnReasons: [], semTerms: [], onsiteTerms: [] });
  });
});

it('reads profit for the resolved SKU only for admins, preserving zero', async () => {
  const path = '/api/product-analysis?sku=I-A&storeId=s1&from=2026-10-21&to=2026-11-19';
  let reads = 0;
  const profit = async (...args: string[]) => {
    reads++;
    expect(args).toEqual(['t1', 's1', 'SKU-A', '2026-10-21', '2026-11-19']);
    return 0;
  };
  const options = { products: async () => catalog, profit };
  const admin = await request(productAnalysisRouter({
    ...options, visibility: async () => ({ ...(await visibility()), role: 'admin' as const }),
  }), path);
  expect((await admin.json()).data.metrics.profit).toBe(0);
  const member = await request(productAnalysisRouter({ ...options, visibility }), path);
  expect((await member.json()).data.metrics).not.toHaveProperty('profit');
  expect(reads).toBe(1);
});
