import { describe, expect, it } from 'vitest';
import { listWfsShipments } from './wfs.js';

const connection = { clientId: 'id', clientSecret: 'secret', environment: 'production' as const, baseUrl: 'https://example.test', accessToken: 'token' };

describe('WFS shipment adapter', () => {
  it('requests all shipment history using creation date bounds and paginates the complete result', async () => {
    const calls: URL[] = [];
    const fetcher = (async (input: URL) => {
      calls.push(input);
      const offset = Number(input.searchParams.get('offset'));
      const payload = offset === 0 ? [{ shipmentId: 'S1' }] : Array.from({ length: 28 }, (_, index) => ({ shipmentId: `S${index + 2}` }));
      return new Response(JSON.stringify({ headers: { offset, limit: 50, totalCount: 78 }, payload }), { status: 200 });
    }) as typeof fetch;
    const shipments: unknown[] = [];
    for await (const shipment of listWfsShipments(connection, {}, fetcher)) shipments.push(shipment);

    expect(shipments).toHaveLength(29);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.searchParams.get('fromCreateDate')).toBe('2000-01-01T00:00:00.000Z');
    expect(calls[0]?.searchParams.get('toCreateDate')).toBeTruthy();
    expect(calls[0]?.searchParams.get('limit')).toBe('50');
    expect(calls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '50']);
  });

  it('allows precise shipment lookup while keeping the all-history date range', async () => {
    const fetcher = (async (input: URL) => {
      expect(input.searchParams.get('shipmentId')).toBe('7858663WFA');
      expect(input.searchParams.get('fromCreateDate')).toBe('2000-01-01T00:00:00.000Z');
      return new Response(JSON.stringify({ headers: { offset: 0, limit: 50, totalCount: 1 }, payload: [{ shipmentId: '7858663WFA' }] }), { status: 200 });
    }) as typeof fetch;
    const rows: unknown[] = [];
    for await (const shipment of listWfsShipments(connection, { shipmentId: '7858663WFA' }, fetcher)) rows.push(shipment);
    expect(rows).toEqual([{ shipmentId: '7858663WFA' }]);
  });

  it('allows incremental sync callers to override the all-history date range', async () => {
    const fetcher = (async (input: URL) => {
      expect(input.searchParams.get('fromCreateDate')).toBe('2026-11-03T08:00:00.000Z');
      expect(input.searchParams.get('toCreateDate')).toBe('2026-11-08T08:00:00.000Z');
      return new Response(JSON.stringify({ headers: { offset: 0, limit: 50, totalCount: 0 }, payload: [] }), { status: 200 });
    }) as typeof fetch;
    for await (const _shipment of listWfsShipments(connection, {
      fromCreateDate: '2026-11-03T08:00:00.000Z',
      toCreateDate: '2026-11-08T08:00:00.000Z',
    }, fetcher)) { /* consume page */ }
  });
});

it('follows shipment nextCursor pages instead of stopping after the first page',async()=>{
 const urls:URL[]=[];const fetcher=(async(url:URL)=>{urls.push(url);return new Response(JSON.stringify(url.searchParams.get('nextCursor')?{payload:[{shipmentId:'S2'}]}:{payload:[{shipmentId:'S1'}],nextCursor:'second'}),{status:200});}) as typeof fetch;
 const rows=[];for await(const row of listWfsShipments(connection,{},fetcher))rows.push(row);
 expect(rows).toHaveLength(2);expect(urls[1].searchParams.get('nextCursor')).toBe('second');
});
