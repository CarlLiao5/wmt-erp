import { describe, expect, it, vi } from 'vitest';
import { walmartRequest } from './request.js';

describe('Walmart request timeout', () => {
  it('aborts a fetch that does not return within the request limit', async () => {
    const connection = { clientId: 'test-client', clientSecret: 'test-secret', environment: 'sandbox' as const, baseUrl: 'https://example.test' };
    const fetcher: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });

    await expect(walmartRequest(connection, '/v3/items', {}, fetcher, 5)).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('Walmart endpoint request buckets', () => {
  const connection = { clientId: 'bucket-test-client', clientSecret: 'test-secret', environment: 'sandbox' as const, baseUrl: 'https://example.test' };

  it('allows independent API buckets to make requests concurrently', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher: typeof fetch = async (input) => {
      started.push(new URL(String(input)).pathname);
      await gate;
      return new Response('{}', { status: 200 });
    };

    const orders = walmartRequest(connection, '/v3/orders', {}, fetcher);
    const returns = walmartRequest(connection, '/v3/returns', {}, fetcher);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual(['/v3/orders', '/v3/returns']);
    release();
    await Promise.all([orders, returns]);
  });

  it('keeps requests in the same API bucket serialized', async () => {
    const serialConnection = { ...connection, clientId: 'serial-test-client' };
    let started = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fetcher: typeof fetch = async () => {
      started++;
      if (started === 1) await firstGate;
      return new Response('{}', { status: 200 });
    };

    const first = walmartRequest(serialConnection, '/v3/orders', {}, fetcher);
    const second = walmartRequest(serialConnection, '/v3/orders', {}, fetcher);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(started).toBe(2);
  });
});

it('paces ITS preview requests ten seconds apart per store credential',async()=>{
 vi.useFakeTimers();
 try {
 const connection={clientId:'its-rate-test',clientSecret:'secret',environment:'production' as const,baseUrl:'https://example.test'};
 const fetcher=vi.fn(async()=>new Response('{}')) as unknown as typeof fetch;
 await walmartRequest(connection,'/v3/fulfillment/inbound-preview',{method:'POST',body:'{}'},fetcher);
 const pending=walmartRequest(connection,'/v3/fulfillment/inbound-preview',{method:'POST',body:'{}'},fetcher);
 await vi.advanceTimersByTimeAsync(9999);expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);await pending;expect(fetcher).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});
