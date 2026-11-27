import { describe, expect, it, vi } from 'vitest';
import { replayWithClaim } from './ops-replay.js';

describe('failed job replay claims', () => {
  it('only retries after one atomic claim and does not retry duplicates', async () => {
    let status: 'failed' | 'queued' = 'failed';
    const claim = vi.fn(async () => { if (status !== 'failed') return false; status = 'queued'; return true; });
    const retry = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => { status = 'failed'; });
    const first = await replayWithClaim({ claim, retry, rollback });
    const second = await replayWithClaim({ claim, retry, rollback });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('restores failed state if the existing queue job cannot be retried', async () => {
    const rollback = vi.fn(async () => undefined);
    await expect(replayWithClaim({ claim: async () => true, retry: async () => { throw new Error('queue unavailable'); }, rollback })).rejects.toThrow('queue unavailable');
    expect(rollback).toHaveBeenCalledOnce();
  });
});
