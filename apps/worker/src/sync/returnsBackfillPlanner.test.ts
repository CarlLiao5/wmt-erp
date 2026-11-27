import { describe, expect, it } from 'vitest';
import { discoverReturnsBoundary, planReturnsIncremental, returnsCreationQuery } from './returnsBackfillPlanner.js';

describe('returns backfill planner', () => {
  it('uses Walmart return creation filter names for historical boundary probes', () => {
    expect(returnsCreationQuery({ from: '2026-01-01T00:00:00Z', to: '2026-01-31T23:59:59Z' })).toEqual({
      returnCreationStartDate: '2026-01-01T00:00:00Z',
      returnCreationEndDate: '2026-01-31T23:59:59Z',
      limit: '200',
    });
  });

  it('records the earliest date returned while probing backwards', async () => {
    const probes: string[] = [];
    const result = await discoverReturnsBoundary({} as never, new Date('2026-10-16T00:00:00Z'), {
      windowDays: 30,
      emptyWindowLimit: 2,
      probe: async ({ from, to }) => {
        probes.push(`${from}:${to}`);
        return from === '2026-08-18' ? { count: 1, earliestDate: '2026-08-22' } : { count: 0 };
      },
    });
    expect(result).toEqual({ earliestAvailable: '2026-08-22', evidence: 'records returned in 2026-08-18..2026-09-16' });
    expect(probes).toContain('2026-08-18:2026-09-16');
  });

  it('stops with an explicit API boundary instead of inventing an older date', async () => {
    await expect(discoverReturnsBoundary({} as never, new Date('2026-10-16T00:00:00Z'), {
      windowDays: 30,
      probe: async () => ({ count: 0, unsupportedBefore: '2026-09-01' }),
    })).resolves.toEqual({ earliestAvailable: '2026-09-01', evidence: 'API boundary reported 2026-09-01' });
  });

  it('uses a seven-day overlap for incremental return status changes', () => {
    expect(planReturnsIncremental(new Date('2026-10-16T12:00:00Z'))).toEqual({ from: '2026-10-09T12:00:00.000Z', to: '2026-10-16T12:00:00.000Z' });
  });
});
