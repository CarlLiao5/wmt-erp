import { describe, expect, it } from 'vitest';
import { assertForwardProgress, createStoreLimiter, runSyncWindow } from './windowRunner.js';
import { retryAfterDelay } from '@walmart-erp/walmart-client';

describe('sync window runner', () => {
  it('checkpoints every page and returns accumulated coverage', async () => {
    const checkpoints: unknown[] = [];
    const pages = [
      { records: 2, nextCursor: 'cursor-2', coverageFrom: '2026-04-19', coverageTo: '2026-04-20' },
      { records: 1, nextCursor: null, coverageFrom: '2026-04-21', coverageTo: '2026-04-22' },
    ];
    const result = await runSyncWindow('window-1', async (cursor) => pages[cursor ? 1 : 0], {
      checkpoint: async (update) => { checkpoints.push(update); },
      complete: async (update) => { checkpoints.push(update); },
    }, createStoreLimiter(0));
    expect(result).toEqual({ windowId: 'window-1', pageCount: 2, recordCount: 3, coverageFrom: '2026-04-19', coverageTo: '2026-04-22' });
    expect(checkpoints).toHaveLength(3);
  });

  it('rejects a repeated cursor instead of looping', () => {
    expect(() => assertForwardProgress('same', 'same')).toThrow('repeated cursor');
  });

  it('allows different stores to acquire independent rate-limit lanes', async () => {
    const limiter = createStoreLimiter(0);
    await Promise.all([limiter.wait('store-a'), limiter.wait('store-b')]);
    expect(limiter.storeCount()).toBe(0);
  });
});

describe('Walmart rate-limit headers', () => {
  it('honors Retry-After and replenishment headers with a 120-second cap', () => {
    expect(retryAfterDelay(new Response(null, { headers: { 'retry-after': '3' } }))).toBe(3_000);
    expect(retryAfterDelay(new Response(null, { headers: { 'x-next-replenishment-time': '999999999999999999' } }))).toBe(120_000);
  });
});
