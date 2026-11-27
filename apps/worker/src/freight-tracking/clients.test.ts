import { describe, expect, it } from 'vitest';
import type { FreightCarrierCredentials } from './credentials.js';
import { createFreightCarrierClient } from './clients.js';

function config(brand: FreightCarrierCredentials['brand']): FreightCarrierCredentials {
  return {
    brand, displayName: brand,
    loginUrl: brand === 'desu' ? 'https://v2.d9tms.com' : `https://${brand}.nextsls.com`,
    searchUrl: brand === 'desu' ? 'https://v2.d9tms.com' : `https://${brand}.nextsls.com`,
    username: 'user', password: 'secret-for-test', prefixPatterns: [], extras: {},
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('freight carrier clients', () => {
  it('logs in, searches by inbound number and fetches qitexp shipment detail', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      const body = typeof init.body === 'string' ? init.body : '';
      calls.push({ url, method: init.method ?? 'GET', headers, body });
      if (url.endsWith('/rest/tms/wos/auth/login')) return jsonResponse({ success: 1, data: { token: 'ephemeral-token' } });
      if (url.endsWith('/rest/tms/wos/shipment/lists')) return jsonResponse({ success: 1, data: { components: { gridView: { table: { dataSource: [{ id: '42', shipment_number: 'QT1001' }] } } } } });
      if (url.includes('/rest/tms/wos/shipment/view?id=42')) return jsonResponse({ success: 1, data: { rows: [{ components: [{ comKey: 'tms-csos-shipment-tracking', data: { dataSource: [] } }] }] } });
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await createFreightCarrierClient(config('qitexp'), fetcher).fetchTracking('QT1001');

    expect(result.matched).toBe(true);
    expect(result.trackingPayload).toMatchObject({ rows: expect.any(Array) });
    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST', 'GET']);
    expect(calls[1].body).toContain('QT1001');
    expect(calls[2].headers.get('token')).toBe('ephemeral-token');
    expect(calls.filter((call) => !call.url.endsWith('/rest/tms/wos/auth/login')).some((call) => call.body.includes('secret-for-test'))).toBe(false);
  });

  it('fetches TT tracking from the REST-prefixed tracking URL in the detail panel', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/rest/tms/wos/auth/login')) return jsonResponse({ success: 1, data: { token: 'token' } });
      if (url.endsWith('/rest/tms/wos/shipment/lists')) return jsonResponse({ success: 1, data: { components: { gridView: { table: { dataSource: [{ id: '42', shipment_number: 'TT1001' }] } } } } });
      if (url.endsWith('/rest/tms/wos/shipment/view?id=42')) return jsonResponse({ success: 1, data: { rows: [{ components: [{ comKey: 'tms-csos-shipment-tracking', data: { body: { components: [{ com: 'tracking', data: { url: '/tms/wos/shipment/view_tracking?id=42' } }] } } }] }] } });
      if (url.endsWith('/rest/tms/wos/shipment/view_tracking?id=42')) return jsonResponse({ success: 1, data: [{ title: '2026-10-22 17:46:57', info: '已下单', event: 'shipment.create' }] });
      throw new Error(`unexpected URL ${url}`);
    };
    const result = await createFreightCarrierClient(config('skytuo'), fetcher).fetchTracking('TT1001');
    expect(result.matched).toBe(true);
    expect((result.trackingPayload as any).rows[0].components[0].data.dataSource).toHaveLength(1);
    expect(calls.some((url) => url.endsWith('/rest/tms/wos/shipment/view_tracking?id=42'))).toBe(true);
  });

  it('does not expose the stored password when qitexp login fails', async () => {
    const client = createFreightCarrierClient(config('qitexp'), async () => jsonResponse({ success: 0, info: 'invalid login' }));
    await expect(client.fetchTracking('QT1001')).rejects.toThrow('Carrier qitexp authentication failed');
    await expect(client.fetchTracking('QT1001')).rejects.not.toThrow('secret-for-test');
  });

  it('pages the desu order mapping in memory and fetches detail plus tracking', async () => {
    const calls: Array<{ url: string; method: string; body: BodyInit | null; headers: Headers }> = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      const headers = new Headers(init.headers);
      const body = init.body ?? null;
      calls.push({ url, method, body, headers });
      if (url.endsWith('/api/auth/login')) return jsonResponse({ code: 200, data: { token: 'desu-token' } });
      if (url.endsWith('/api/order/page')) {
        const page = JSON.parse(String(body)).current;
        return jsonResponse({ code: 200, data: { total: 51, records: [{ orderCode: page === 1 ? 'DSL1001' : 'DSL1002', id: page === 1 ? 99 : 100 }] } });
      }
      if (url.endsWith('/api/order/details?orderId=99')) return jsonResponse({ code: 200, data: { orderCode: 'DSL1001' } });
      if (url.endsWith('/api/status/track')) return jsonResponse({ code: 200, data: [{ trackDate: '2026-10-22 12:00:00', statusDecl: '已签收', status: 'POD', isMake: true }, { trackDate: '2026-10-25 12:00:00', statusDecl: '待签收', status: 'NEXT', isMake: false }] });
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await createFreightCarrierClient(config('desu'), fetcher).fetchTracking('DSL1001');

    expect(result.matched).toBe(true);
    expect(calls.filter((call) => call.url.endsWith('/api/order/page'))).toHaveLength(2);
    expect(calls.find((call) => call.url.endsWith('/api/status/track'))?.method).toBe('POST');
    expect(result.rawPayload).toMatchObject({ detail: { orderCode: 'DSL1001' }, tracking: { code: 200 } });
    expect(result.trackingPayload).toMatchObject({ _brand: 'desu', rows: expect.any(Array) });
    expect((result.trackingPayload as any).rows[0].components[0].data.body.components[0].data.dataSource[1].isCompleted).toBe(false);
  });
});
