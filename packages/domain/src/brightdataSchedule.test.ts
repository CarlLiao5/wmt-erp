import { describe, expect, it } from 'vitest';
import { brightDataScheduleDay, nextBrightDataRunAt } from './brightdataSchedule.js';

describe('Bright Data daily schedule', () => {
  it('chooses the next 16:00 Asia/Shanghai instant', () => {
    expect(nextBrightDataRunAt(new Date('2026-10-20T07:59:00.000Z')).toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(nextBrightDataRunAt(new Date('2026-10-20T08:00:00.000Z')).toISOString()).toBe('2026-10-21T08:00:00.000Z');
  });

  it('uses the China calendar date for scheduled run identity', () => {
    expect(brightDataScheduleDay(new Date('2026-10-20T08:00:00.000Z'))).toBe('2026-10-20');
  });
});
