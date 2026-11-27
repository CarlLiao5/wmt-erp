import { describe, expect, it } from 'vitest';
import { nextScheduledRunAt } from './syncPolicies.js';

describe('nextScheduledRunAt', () => {
  it('advances ordinary plans from their own interval anchor', () => {
    const next = nextScheduledRunAt(
      'orders',
      new Date('2026-10-28T13:42:30.000Z'),
      new Date('2026-10-28T13:15:00.000Z'),
      15,
    );

    expect(next.toISOString()).toBe('2026-10-28T13:45:00.000Z');
  });

  it('skips missed ordinary intervals to the next future slot', () => {
    const next = nextScheduledRunAt(
      'returns',
      new Date('2026-10-28T13:42:30.000Z'),
      new Date('2026-10-28T10:00:00.000Z'),
      60,
    );

    expect(next.toISOString()).toBe('2026-10-28T14:00:00.000Z');
  });

  it('keeps tenant fixed daily schedules at their configured China time', () => {
    expect(nextScheduledRunAt('head-freight', new Date('2026-10-28T13:00:00.000Z'), undefined, undefined, '__tenant__').toISOString())
      .toBe('2026-10-29T12:00:00.000Z');
    expect(nextScheduledRunAt('freight-tracking', new Date('2026-10-28T02:00:00.000Z'), undefined, undefined, '__tenant__').toISOString())
      .toBe('2026-10-28T03:00:00.000Z');
    expect(nextScheduledRunAt('head-freight', new Date('2026-10-28T13:00:00.000Z'), undefined, undefined, 'store-1').toISOString())
      .toBe('2026-10-29T13:00:00.000Z');
  });

  it('keeps tenant weekly schedules on Friday at 20:00 China time', () => {
    expect(nextScheduledRunAt('smart-sheet-allsku2026', new Date('2026-10-28T13:00:00.000Z'), undefined, undefined, '__tenant__').toISOString())
      .toBe('2026-10-30T12:00:00.000Z');
  });
});

it('schedules ITS fee scans daily',async()=>{
 const {incrementalSyncPolicy}=await import('./syncPolicies.js');
 expect(incrementalSyncPolicy('wfs-inbound-preview')).toEqual({intervalMinutes:1440,overlapDays:5});
});

it('schedules inventory reconciliation on the 2nd and 8th of each month',()=>{
 expect(nextScheduledRunAt('inventory-recon',new Date('2026-11-01T00:00Z')).toISOString()).toBe('2026-11-02T04:00:00.000Z');
 expect(nextScheduledRunAt('inventory-recon',new Date('2026-11-02T04:00Z')).toISOString()).toBe('2026-11-08T04:00:00.000Z');
 expect(nextScheduledRunAt('inventory-recon',new Date('2026-12-09T04:00Z')).toISOString()).toBe('2027-01-02T04:00:00.000Z');
});
