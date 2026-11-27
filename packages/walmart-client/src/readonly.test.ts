import { describe, expect, it, vi } from 'vitest';
import { assertReadOnly } from './readonly.js';
import { walmartRequest } from './request.js';

const connection = { clientId: 'id', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.test' };

describe('Walmart read-only request policy', () => {
  it('allows resource GETs and token authentication', () => {
    expect(() => assertReadOnly('GET', '/v3/items')).not.toThrow();
    expect(() => assertReadOnly('POST', '/v3/token')).not.toThrow();
  });

  it.each([
    '/v3/price/getPricingInsights',
    '/v3/fulfillment/inbound-preview',
    '/v3/advertising/sem/campaigns/123/item-level-summary',
    '/v3/advertising/sem/campaigns/performance-summary',
    '/v3/reports/reportRequests?reportType=SEM_PERFORMANCE&reportVersion=v1',
    '/v3/reports/reportRequests?reportType=SEM_SEARCH_TERMS&reportVersion=v1',
  ])('allows the approved read/query POST %s', (path) => {
    expect(() => assertReadOnly('POST', path)).not.toThrow();
  });

  it.each([
    ['POST', '/v3/orders'],
    ['POST', '/v3/reports/reportRequests?reportType=ORDERS&reportVersion=v1'],
    ['PUT', '/v3/items/123'],
    ['PATCH', '/v3/items/123'],
    ['DELETE', '/v3/items/123'],
  ])('rejects unapproved Walmart writes: %s %s', (method, path) => {
    expect(() => assertReadOnly(method, path)).toThrow('read-only');
  });

  it('blocks unapproved writes before invoking the network fetcher', async () => {
    const fetcher = async () => new Response(null, { status: 200 });
    const call = vi.fn(fetcher);
    await expect(walmartRequest(connection, '/v3/items', { method: 'DELETE' }, call)).rejects.toThrow('read-only');
    expect(call).not.toHaveBeenCalled();
  });

  it('allows only the versioned ITEM CSV report request on the generic report endpoint', () => {
    const path = '/v3/reports/reportRequests?reportType=ITEM&reportVersion=v1';
    expect(() => assertReadOnly('POST', path, JSON.stringify({ format: 'CSV' }))).not.toThrow();
    expect(() => assertReadOnly('POST', '/v3/reports/reportRequests?reportType=ITEM', JSON.stringify({ format: 'CSV' }))).toThrow('read-only');
    expect(() => assertReadOnly('POST', '/v3/reports/reportRequests?reportType=ORDERS&reportVersion=v1', JSON.stringify({ format: 'CSV' }))).toThrow('read-only');
    expect(() => assertReadOnly('POST', path, JSON.stringify({ reportType: 'ITEM', format: 'CSV' }))).toThrow('read-only');
  });
});
