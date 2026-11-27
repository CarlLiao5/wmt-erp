import { describe, expect, it, vi } from 'vitest';
import { listAvailableReconPeriods, listReconRows } from './reports.js';

const connection = { clientId: 'id', clientSecret: 'secret', environment: 'production' as const, baseUrl: 'https://example.test', accessToken: 'token' };

describe('Recon report adapter', () => {
  it('normalizes available report dates into periods', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ availableApReportDates: ['10062026', '09292026'] }), { status: 200 }));
    await expect(listAvailableReconPeriods(connection, fetcher as typeof fetch)).resolves.toEqual([
      { reportDate: '10062026' },
      { reportDate: '09292026' },
    ]);
  });

  it('iterates Recon rows in 1000-record pages until nextOffset ends', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: URL) => {
      calls.push(input.search);
      const offset = Number(input.searchParams.get('offset'));
      return new Response(JSON.stringify(offset === 0
        ? { reportData: [{ id: 1 }], nextOffset: 1000 }
        : { reportData: [{ id: 2 }], nextOffset: -1 }), { status: 200 });
    });
    const rows: unknown[] = [];
    for await (const row of listReconRows(connection, { reportDate: '10062026' }, fetcher as typeof fetch)) rows.push(row);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toEqual(['?reportDate=10062026&offset=0&noOfRecords=1000', '?reportDate=10062026&offset=1000&noOfRecords=1000']);
  });
});
