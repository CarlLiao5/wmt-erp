import { describe, expect, it, vi } from 'vitest';
import { assertReadOnly } from './readonly.js';
import { walmartGet } from './transport.js';
import { getAccessToken } from './auth/token.js';
const connection = { clientId:'id', clientSecret:'secret', environment:'sandbox' as const, baseUrl:'https://example.test' };
describe('read-only Walmart connector',()=>{ it.each(['POST','PUT','PATCH','DELETE'])('rejects %s business method', method=>expect(()=>assertReadOnly(method,'/v3/items')).toThrow('read-only')); it('sends Walmart-required headers with token requests',async()=>{ const calls: RequestInit[]=[]; const fetcher=vi.fn(async (_url:string, init?:RequestInit)=>{calls.push(init??{}); return new Response(JSON.stringify({access_token:'a',expires_in:900}),{status:200,headers:{'content-type':'application/json'}}); }) as unknown as typeof fetch; await getAccessToken(connection,fetcher); await walmartGet({...connection,accessToken:'a',accessTokenExpiresAt:Date.now()+300_000},'/v3/items',{fetcher}); expect(calls[0].method).toBe('POST'); const tokenHeaders=calls[0].headers as Record<string,string>; expect(tokenHeaders['WM_SVC.NAME']).toBe('Walmart Marketplace'); expect(tokenHeaders['WM_QOS.CORRELATION_ID']).toMatch(/^[0-9a-f-]{36}$/i); expect(calls[1].method).toBe('GET'); expect((calls[1].headers as Record<string,string>)['WM_QOS.CORRELATION_ID']).toBeTruthy(); }); });

it('retries a successful response whose JSON body is empty or truncated', async () => {
  const responses = [new Response('', { status: 200 }), new Response('{"items":[]}', { status: 200 })];
  let calls = 0;
  const fetcher = (async () => { calls++; return responses.shift()!; }) as unknown as typeof fetch;

  await expect(walmartGet({ ...connection, accessToken: 'token', accessTokenExpiresAt: Date.now() + 300_000 }, '/v3/inventories', { fetcher, maxAttempts: 2 })).resolves.toMatchObject({ data: { items: [] }, status: 200 });
  expect(calls).toBe(2);
});

it('reports the endpoint and response metadata after malformed JSON retries are exhausted', async () => {
  const fetcher = (async () => new Response('', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  await expect(walmartGet({ ...connection, accessToken: 'token', accessTokenExpiresAt: Date.now() + 300_000 }, '/v3/wfs/inventory', { fetcher, maxAttempts: 1 })).rejects.toThrow('Invalid JSON from /v3/wfs/inventory (HTTP 200, 0 bytes)');
});

it('treats HTTP 204 from the shipment collection as a successful empty response', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;

  await expect(walmartGet({ ...connection, clientId: 'empty-shipment-client', accessToken: 'token', accessTokenExpiresAt: Date.now() + 300_000 }, '/v3/fulfillment/inbound-shipments', { fetcher })).resolves.toMatchObject({ data: {}, status: 204 });
  expect(calls).toBe(1);
});

it('retries transient network failures and reports the endpoint when exhausted', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw new TypeError('fetch failed'); }) as unknown as typeof fetch;

  await expect(walmartGet({ ...connection, accessToken: 'token', accessTokenExpiresAt: Date.now() + 300_000 }, '/v3/inventories', { fetcher, maxAttempts: 2 })).rejects.toThrow('Walmart network request failed for /v3/inventories: fetch failed');
  expect(calls).toBe(2);
});
