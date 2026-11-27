import { describe, expect, it, vi } from 'vitest';
import { getFulfillmentInventory, getInventoryHealth, listWfsInventoryLog } from './inventory.js';

describe('WFS inventory adapter', () => {
  it('uses the WFS GET endpoint and paginates by response headers', async () => {
    const calls: string[] = [];
    const methods: Array<string | undefined> = [];
    const fetcher = vi.fn(async (input: URL, init?: RequestInit) => {
      calls.push(input.pathname + input.search);
      methods.push(init?.method);
      const offset = Number(input.searchParams.get('offset'));
      const inventory = offset === 0 ? [{ itemInformation: { sku: 'A' } }] : [{ itemInformation: { sku: 'B' } }];
      return new Response(JSON.stringify({ headers: { offset, limit: 1, totalCount: 2 }, payload: { inventory } }), { status: 200 });
    });
    const rows: unknown[] = [];
    for await (const row of getInventoryHealth({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, { limit: '1' }, fetcher as typeof fetch)) rows.push(row);
    expect(rows).toHaveLength(2);
    expect(calls).toEqual(['/v3/wfs/inventory?limit=1&offset=0', '/v3/wfs/inventory?limit=1&offset=1']);
    expect(methods).toEqual(['GET', 'GET']);
  });

  it('reads ship-node quantities from the fulfillment inventory GET endpoint', async () => {
    const fetcher = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.pathname).toBe('/v3/fulfillment/inventory');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify({ inventory: [{ sku: 'A', shipNodes: [{ shipNode: 'LAX1', availToSellQty: 4 }] }] }), { status: 200 });
    });
    const rows: unknown[] = [];
    for await (const row of getFulfillmentInventory({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, {}, fetcher as typeof fetch)) rows.push(row);
    expect(rows).toHaveLength(1);
  });

  it('passes inventory-log dates and offset to the WFS endpoint', async () => {
    const fetcher = vi.fn(async (input: URL) => {
      expect(input.pathname).toBe('/v3/fulfillment/inventory-log');
      expect(input.searchParams.get('startDate')).toBe('2026-10-01');
      expect(input.searchParams.get('endDate')).toBe('2026-10-16');
      expect(input.searchParams.get('offset')).toBe('0');
      expect(input.searchParams.get('limit')).toBe('50');
      return new Response(JSON.stringify({ payload: { inventoryLog: [] } }), { status: 200 });
    });
    await listWfsInventoryLog({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, { gtin: '123', startDate: '2026-10-01', endDate: '2026-10-16' }, fetcher as typeof fetch);
  });

  it('rejects inventory-log ranges over the direct API 365-day limit', async () => {
    await expect(listWfsInventoryLog({ clientId: 'id', clientSecret: 'secret', environment: 'production', baseUrl: 'https://example.test', accessToken: 'token' }, { gtin: '123', startDate: '2025-01-01', endDate: '2026-10-16' })).rejects.toThrow('365 days');
  });
});
