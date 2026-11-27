import { describe, expect, it } from 'vitest';
import { planOrderWindows, refineOrderWindow, type OrderWindow } from './orderBackfillPlanner.js';

const now = new Date('2026-10-16T12:00:00.000Z');

describe('order backfill planner', () => {
  it('plans no order window older than the 180-day boundary', () => {
    const windows = planOrderWindows({ now, oldestAllowedDays: 180, maxQueryResults: 10_000, initialWindowDays: 30 });
    expect(windows[0]?.from).toBe('2026-04-19');
    expect(windows.at(-1)?.to).toBe('2026-10-16');
    expect(windows.every((window) => window.from >= '2026-04-19' && window.to <= '2026-10-16')).toBe(true);
  });

  it('splits a window when Walmart reports more than 10000 results', () => {
    const window: OrderWindow = { from: '2026-04-19', to: '2026-05-18', maxQueryResults: 10_000 };
    const refined = refineOrderWindow(window, { totalCount: 10_001 });
    expect(refined).toHaveLength(2);
    expect(refined.map(({ from, to }) => `${from}:${to}`)).toEqual(['2026-04-19:2026-05-03', '2026-05-04:2026-05-18']);
  });

  it('does not split a window below the result limit', () => {
    const window: OrderWindow = { from: '2026-10-15', to: '2026-10-16', maxQueryResults: 10_000 };
    expect(refineOrderWindow(window, { totalCount: 10_000 })).toEqual([window]);
  });
});
