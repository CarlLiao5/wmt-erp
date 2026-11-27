import { afterEach, expect, it, vi } from 'vitest';
import { syncOrders } from './syncOrders.js';
import { syncReturns } from './syncReturns.js';
import { projectCommerceRows } from '../../../api/src/routes/commerce-source.js';

afterEach(() => vi.unstubAllGlobals());

it('uses only Walmart GET resources and preserves raw response references', async () => {
  const requests: Array<{ method?: string; path: string }> = [];
  vi.stubGlobal('fetch', async (input: URL, init?: RequestInit) => {
    requests.push({ method: init?.method, path: input.pathname });
    const data = input.pathname === '/v3/orders' ? { orders: [{ purchaseOrderId: 'po-1', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] } : { returns: [{ returnOrderId: 'r-1', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REFUNDED', refundAmount: { amount: 5 } }] }] };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const connection = { clientId: 'id', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.invalid', accessToken: 'token' };
  const window = { tenantId: 't', storeId: 's', from: '2026-01-02', to: '2026-01-03' };
  const raw = new Set<string>();
  const lineRefs: string[] = [];
  const snapshots: Array<{ returnId: string; status: string; rawResponseId: string }> = [];
  await syncOrders(window, connection, async (_payload, id) => { raw.add(id); }, async (line) => { lineRefs.push(line.rawResponseId); });
  await syncReturns(window, connection, async (_payload, id) => { raw.add(id); }, async (line) => { lineRefs.push(line.rawResponseId); }, async (snapshot) => { snapshots.push(snapshot); });
  expect(requests).toEqual([{ method: 'GET', path: '/v3/orders' }, { method: 'GET', path: '/v3/orders' }, { method: 'GET', path: '/v3/returns' }]);
  expect(lineRefs).toHaveLength(2);
  expect(lineRefs.every((id) => raw.has(id))).toBe(true);
  expect(snapshots).toMatchObject([{ returnId: 's:r-1:1', rawResponseId: lineRefs[1] }]);
});

it('keeps one current row across separate runs and appends only new return states', async () => {
  let returnStatus = 'REQUESTED';
  vi.stubGlobal('fetch', async (input: URL) => new Response(JSON.stringify(input.pathname === '/v3/orders'
    ? { orders: [{ purchaseOrderId: 'o1', orderDate: '2026-01-01', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] }
    : { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: returnStatus }] }] }), { status: 200 }));
  const connection = { clientId: 'id', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.invalid', accessToken: 'token' };
  const window = { tenantId: 't', storeId: 's', from: '2026-01-01', to: '2026-01-04' };
  const raw: Array<{ id: string; tenantId: string; storeId: string; resource: string; payload: unknown }> = [];
  const persist = (resource: string) => async (payload: unknown, id: string) => { raw.push({ id, tenantId: 't', storeId: 's', resource, payload }); };
  for (let run = 0; run < 2; run++) {
    await syncOrders(window, connection, persist('orders'), async () => {});
    await syncReturns(window, connection, persist('returns'), async () => {});
  }
  expect(projectCommerceRows(raw)).toMatchObject({ orders: [{ id: 's:o1:1' }], returns: [{ id: 's:r1:1', status: 'REQUESTED' }], snapshots: [{ status: 'REQUESTED' }] });
  returnStatus = 'REFUNDED';
  await syncReturns(window, connection, persist('returns'), async () => {});
  expect(projectCommerceRows(raw).snapshots.map((snapshot) => snapshot.status)).toEqual(['REQUESTED', 'REFUNDED']);
}, 15000);
