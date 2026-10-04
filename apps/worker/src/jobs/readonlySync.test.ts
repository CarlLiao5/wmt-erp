import { afterEach, expect, it, vi } from 'vitest';
import { syncOrders } from './syncOrders.js';
import { syncReturns } from './syncReturns.js';

afterEach(() => vi.unstubAllGlobals());

it('uses only Walmart GET resources and preserves raw response references', async () => {
  const requests: Array<{ method?: string; path: string }> = [];
  vi.stubGlobal('fetch', async (input: URL, init?: RequestInit) => {
    requests.push({ method: init?.method, path: input.pathname });
    const data = input.pathname === '/v3/orders' ? { orders: [{ purchaseOrderId: 'po-1', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] } : { returns: [{ returnOrderId: 'r-1', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' } }] }] };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const connection = { clientId: 'id', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.invalid', accessToken: 'token' };
  const window = { tenantId: 't', storeId: 's', from: '2026-01-02', to: '2026-01-03' };
  const raw = new Set<string>();
  const lineRefs: string[] = [];
  const snapshots: Array<{ returnId: string; status: string; rawResponseId: string }> = [];
  await syncOrders(window, connection, async (_payload, id) => { raw.add(id); }, async (line) => { lineRefs.push(line.rawResponseId); });
  await syncReturns(window, connection, async (_payload, id) => { raw.add(id); }, async (line) => { lineRefs.push(line.rawResponseId); }, async (snapshot) => { snapshots.push(snapshot); });
  expect(requests).toEqual([{ method: 'GET', path: '/v3/orders' }, { method: 'GET', path: '/v3/returns' }]);
  expect(lineRefs).toHaveLength(2);
  expect(lineRefs.every((id) => raw.has(id))).toBe(true);
  expect(snapshots).toMatchObject([{ returnId: 's:r-1:1', rawResponseId: lineRefs[1] }]);
});
