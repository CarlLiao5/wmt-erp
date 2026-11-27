import { describe, expect, it } from 'vitest';
import { retentionCutoffs, retentionPlan } from './retention.js';

describe('retention policy', () => {
  it('computes UTC cutoffs without mutating the input date', () => {
    const now = new Date('2026-10-15T00:00:00.000Z');
    const result = retentionCutoffs(now, { rawPayloadDays: 180, syncJobDays: 30 });
    expect(now.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(result.rawPayloadBefore.toISOString()).toBe('2026-04-18T00:00:00.000Z');
    expect(result.syncJobBefore.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('rejects unsafe retention values and only purges terminal jobs', () => {
    expect(() => retentionCutoffs(new Date(), { rawPayloadDays: 0, syncJobDays: 30 })).toThrow(/positive/);
    expect(retentionPlan(new Date('2026-10-15T00:00:00.000Z'), { rawPayloadDays: 180, syncJobDays: 30 })[1].sql).toContain("status IN ('completed', 'failed')");
  });
});
