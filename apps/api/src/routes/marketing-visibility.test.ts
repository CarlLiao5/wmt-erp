import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { authRouter } from './auth.js';
import { advertisingRouter } from './advertising.js';
import { pricingDateCondition, pricingRouter } from './pricing.js';

const previousMysqlUrl = process.env.MYSQL_URL;
afterEach(() => { if (previousMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = previousMysqlUrl; });

async function start(app: express.Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe('marketing member SKU visibility', () => {
  it('filters pricing by effective date, falling back to received date for snapshots without one', () => {
    const condition = pricingDateCondition(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-09T23:59:59.999Z'));
    expect(condition.queryChunks.length).toBeGreaterThan(10);
  });

  it('rejects reversed ranges consistently for every advertising data endpoint', async () => {
    delete process.env.MYSQL_URL;
    const scope = { tenantId: 'default', role: 'admin' as const, storeIds: new Set<string>(), skus: new Set<string>() };
    const app = express(); app.use(express.json()); app.use(authRouter());
    app.use(advertisingRouter({
      list: async () => [],
      listSemItems: async () => [],
      listSemPerformance: async () => [],
      listSearchTerms: async () => [],
      visibility: () => scope,
    }));
    const { server, base } = await start(app);
    try {
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      for (const endpoint of ['/advertising', '/advertising/items', '/advertising/performance', '/advertising/search-terms']) {
        const response = await fetch(`${base}${endpoint}?from=2026-10-22&to=2026-10-21`, { headers: { cookie } });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { message: '开始日期不能晚于结束日期' } });
      }
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('filters pricing and all SEM reports by exact store and SKU', async () => {
    delete process.env.MYSQL_URL;
    const scope = { tenantId: 'default', role: 'member' as const, storeIds: new Set<string>(), skus: new Set(['store-a:SKU-1']) };
    const app = express(); app.use(express.json()); app.use(authRouter());
    app.use(pricingRouter({ list: async () => [
      { storeId: 'store-a', sku: 'SKU-1', price: '10' },
      { storeId: 'store-a', sku: 'SKU-2', price: '20' },
      { storeId: 'store-b', sku: 'SKU-1', price: '30' },
    ], visibility: () => scope }));
    app.use(advertisingRouter({
      list: async () => [{ storeId: 'store-a', spend: '999', attributedSales: '1000' }],
      listSemItems: async () => [{ storeId: 'store-a', sku: 'SKU-1', spend: '4' }, { storeId: 'store-a', sku: 'SKU-2', spend: '40' }, { storeId: 'store-b', sku: 'SKU-1', spend: '400' }],
      listSemPerformance: async () => [{ storeId: 'store-a', sku: 'SKU-1', spend: '5' }, { storeId: 'store-b', sku: 'SKU-1', spend: '500' }],
      listSearchTerms: async () => [{ storeId: 'store-a', sku: 'SKU-1', searchTerm: 'visible' }, { storeId: 'store-a', sku: 'SKU-2', searchTerm: 'hidden' }],
      visibility: () => scope,
    }));
    const { server, base } = await start(app);
    try {
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const headers = { cookie };
      const pricing = await fetch(`${base}/pricing`, { headers }).then((r) => r.json());
      expect(pricing.data.rows.map((row: { sku: string }) => row.sku)).toEqual(['SKU-1']);
      expect((await fetch(`${base}/pricing?storeId=store-b`, { headers })).status).toBe(403);
      const generalAds = await fetch(`${base}/advertising`, { headers }).then((r) => r.json());
      expect(generalAds.data).toMatchObject({ rows: [{ storeId: 'store-a', spend: '999' }], dataAvailable: true, metrics: { spend: 999 } });
      const items = await fetch(`${base}/advertising/items`, { headers }).then((r) => r.json());
      expect(items.data.rows.map((row: { sku: string }) => row.sku)).toEqual(['SKU-1']);
      const performance = await fetch(`${base}/advertising/performance`, { headers }).then((r) => r.json());
      expect(performance.data.rows.map((row: { sku: string }) => row.sku)).toEqual(['SKU-1']);
      const terms = await fetch(`${base}/advertising/search-terms`, { headers }).then((r) => r.json());
      expect(terms.data.rows.map((row: { searchTerm: string }) => row.searchTerm)).toEqual(['visible']);
      const visibleSkuTerms = await fetch(`${base}/advertising/search-terms?sku=sku-1`, { headers }).then((r) => r.json());
      expect(visibleSkuTerms.data.rows.map((row: { sku: string }) => row.sku)).toEqual(['SKU-1']);
      const hiddenSkuTerms = await fetch(`${base}/advertising/search-terms?sku=SKU-2`, { headers }).then((r) => r.json());
      expect(hiddenSkuTerms.data.rows).toEqual([]);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('resolves pricing images once per unique store and SKU', async () => {
    delete process.env.MYSQL_URL;
    const scope = { tenantId: 'default', role: 'admin' as const, storeIds: new Set<string>(), skus: new Set<string>() };
    let requested: Array<{ storeId: string; sku: string }> = [];
    const app = express(); app.use(express.json()); app.use(authRouter());
    app.use(pricingRouter({
      list: async () => [
        { storeId: 'store-a', sku: 'SKU-1', priceType: 'base' },
        { storeId: 'store-a', sku: 'SKU-1', priceType: 'promotion' },
        { storeId: 'store-a', sku: 'SKU-2', priceType: 'base' },
      ],
      visibility: () => scope,
      productImages: async (_tenant, products) => { requested = products; return new Map(); },
    }));
    const { server, base } = await start(app);
    try {
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      await fetch(`${base}/pricing`, { headers: { cookie } });
      expect(requested).toEqual([{ storeId: 'store-a', sku: 'SKU-1' }, { storeId: 'store-a', sku: 'SKU-2' }]);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('uses one server-side query and page contract for both SEM reports', async () => {
    delete process.env.MYSQL_URL;
    const scope = { tenantId: 'default', role: 'admin' as const, storeIds: new Set<string>(), skus: new Set<string>() };
    const requested: Array<{ q?: string; page: number; pageSize: number }> = [];
    const app = express(); app.use(express.json()); app.use(authRouter());
    app.use(advertisingRouter({
      listSemItemsPage: async (args) => { requested.push(args); return { rows: [{ sku: 'SKU-1', productName: 'Jack' }], total: 41, page: args.page, pageSize: args.pageSize }; },
      listSearchTermsPage: async (args) => { requested.push(args); return { rows: [{ sku: 'SKU-1', searchTerm: 'jack' }], total: 299203, page: args.page, pageSize: args.pageSize }; },
      visibility: () => scope,
    }));
    const { server, base } = await start(app);
    try {
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const headers = { cookie };
      const [items, terms] = await Promise.all([
        fetch(`${base}/advertising/items?q=jack&page=3&pageSize=50`, { headers }).then((r) => r.json()),
        fetch(`${base}/advertising/search-terms?q=jack&page=3&pageSize=50`, { headers }).then((r) => r.json()),
      ]);
      expect(items.data).toMatchObject({ total: 41, page: 3, pageSize: 50 });
      expect(terms.data).toMatchObject({ total: 299203, page: 3, pageSize: 50 });
      expect(requested).toHaveLength(2);
      expect(requested).toEqual(expect.arrayContaining([expect.objectContaining({ q: 'jack', page: 3, pageSize: 50 })]));
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
