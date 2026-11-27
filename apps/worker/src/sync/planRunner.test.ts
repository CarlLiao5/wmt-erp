import { describe, expect, it } from 'vitest';
import { runIncrementalPlans, runInitialPlan, type PlanRepository, type PlanWindow } from './planRunner.js';

const window = (id: string, status: string = 'planned'): PlanWindow => ({ id, tenantId: 't', storeId: 's', resource: id, batchId: `batch-${id}`, from: '2026-10-01', to: '2026-10-02', status });

describe('sync plan runner', () => {
  it('runs independent pending windows and marks the plan completed', async () => {
    const updates: Array<[string, string]> = [];
    const repository: PlanRepository = {
      getPlan: async () => ({ id: 'plan-1', tenantId: 't', storeId: 's', windows: [window('orders'), window('returns')] }),
      updateWindow: async (id, patch) => { updates.push([id, patch.status]); },
      updatePlan: async (_id, patch) => { updates.push(['plan', patch.status]); },
      listIncrementalPlans: async () => [],
      createWindow: async (value) => ({ ...value, id: 'incremental-1', status: 'planned' }),
    };
    const result = await runInitialPlan('plan-1', repository, async () => undefined);
    expect(result).toMatchObject({ status: 'completed', completedWindows: 2, failedWindows: 0 });
    expect(updates).toEqual([['orders', 'running'], ['orders', 'completed'], ['returns', 'running'], ['returns', 'completed'], ['plan', 'completed']]);
  });

  it('retries only failed windows and keeps a partial plan when one retry fails', async () => {
    const executed: string[] = [];
    const updates: Array<[string, string]> = [];
    const repository: PlanRepository = {
      getPlan: async () => ({ id: 'plan-1', tenantId: 't', storeId: 's', windows: [window('orders', 'completed'), window('returns', 'failed')] }),
      updateWindow: async (id, patch) => { updates.push([id, patch.status]); },
      updatePlan: async (_id, patch) => { updates.push(['plan', patch.status]); },
      listIncrementalPlans: async () => [],
      createWindow: async (value) => ({ ...value, id: 'incremental-1', status: 'planned' }),
    };
    const result = await runInitialPlan('plan-1', repository, async (current) => { executed.push(current.id); if (current.id === 'returns') throw new Error('429'); });
    expect(executed).toEqual(['returns']);
    expect(result).toMatchObject({ status: 'partial', completedWindows: 1, failedWindows: 1 });
    expect(updates.at(-1)).toEqual(['plan', 'partial']);
  });

  it('creates overlapping incremental windows per active resource', async () => {
    const created: PlanWindow[] = [];
    const repository: PlanRepository = {
      getPlan: async () => undefined,
      updateWindow: async () => undefined,
      updatePlan: async () => undefined,
      listIncrementalPlans: async () => [{ id: 'plan-1', tenantId: 't', storeId: 's', resource: 'returns', overlapDays: 7 }],
      createWindow: async (value) => { const next = { ...value, id: 'window-1', status: 'planned' as const }; created.push(next); return next; },
    };
    const result = await runIncrementalPlans(new Date('2026-10-16T12:00:00Z'), repository, async () => undefined);
    expect(created[0]).toMatchObject({ from: '2026-10-09T12:00:00.000Z', to: '2026-10-16T12:00:00.000Z' });
    expect(result[0]).toMatchObject({ status: 'completed', completedWindows: 1 });
  });
});
