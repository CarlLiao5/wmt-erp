import { describe, expect, it } from 'vitest';
import { waitForItemReport } from './syncItemReport.js';

describe('Item report status polling', () => {
  it('checks the report immediately and returns when Walmart already marks it ready', async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const result = await waitForItemReport('req-1', async (id) => { calls.push(id); return { reportRequest: { requestId: id, status: 'READY' } }; }, async (milliseconds) => { waits.push(milliseconds); });
    expect(calls).toEqual(['req-1']);
    expect(waits).toEqual([]);
    expect(result.status).toBe('READY');
  });

  it('checks RECEIVED immediately before applying the long polling interval', async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const result = await waitForItemReport('req-1', async (id) => {
      calls.push(id);
      return { reportRequest: { requestId: id, status: 'READY' } };
    }, async (milliseconds) => { waits.push(milliseconds); }, { status: 'RECEIVED' });
    expect(calls).toEqual(['req-1']);
    expect(waits).toEqual([]);
    expect(result.status).toBe('READY');
  });

  it('fails a report immediately when Walmart returns FAILED', async () => {
    await expect(waitForItemReport('req-2', async () => ({ status: 'FAILED' }), async () => undefined)).rejects.toThrow('Walmart Item report failed: FAILED');
  });
});
