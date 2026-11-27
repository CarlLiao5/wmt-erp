import { describe, expect, it, vi } from 'vitest';
import { normalizeItemReportCsv, requestItemReport } from './itemReport.js';

const connection = { clientId: 'client', clientSecret: 'secret', environment: 'sandbox' as const, baseUrl: 'https://example.test', accessToken: 'token', accessTokenExpiresAt: Date.now() + 300_000 };

describe('Walmart Item report adapter', () => {
  it('parses quoted commas and escaped quotes while preserving the source fields', () => {
    const rows = normalizeItemReportCsv('\uFEFFSKU,Product Name,Price,Buy Box Eligible,Ship Methods\r\nSKU-1,"Widget, ""Deluxe""",12.50,true,"WFS, Seller Fulfilled"\r\n');
    expect(rows).toEqual([{ sku: 'SKU-1', productName: 'Widget, "Deluxe"', productId: null, brand: null, publishStatus: null, primaryImageUrl: null, fields: { SKU: 'SKU-1', 'Product Name': 'Widget, "Deluxe"', Price: '12.50', 'Buy Box Eligible': 'true', 'Ship Methods': 'WFS, Seller Fulfilled' } }]);
  });

  it('maps the Walmart Item ID from the report', () => {
    const [row] = normalizeItemReportCsv('SKU,Item ID,WPID,Product Name\r\nSKU-1,6149202826,22V3YUV6NPZS,Widget\r\n');
    expect(row).toMatchObject({ sku: 'SKU-1', productId: '6149202826' });
  });

  it('requests the ITEM CSV report with the required reportType and reportVersion query parameters', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ requestId: 'request-1', reportType: 'ITEM', status: 'RECEIVED' }), { status: 202, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const result = await requestItemReport(connection, fetcher);
    expect(result).toMatchObject({ requestId: 'request-1', reportType: 'ITEM', status: 'RECEIVED' });
    const [calledUrl, calledInit] = (fetcher as any).mock.calls[0];
    expect(String(calledUrl)).toContain('/v3/reports/reportRequests?reportType=ITEM&reportVersion=v1');
    expect(calledInit).toMatchObject({ method: 'POST', body: JSON.stringify({ format: 'CSV' }) });
  });
});
