export interface PlanWindow {
  id: string;
  tenantId: string;
  storeId: string;
  resource: string;
  batchId: string;
  from: string;
  to: string;
  status: string;
}

export interface IncrementalPlan { id: string; tenantId: string; storeId: string; resource: string; overlapDays: number; }
export interface PlanRecord { id: string; tenantId: string; storeId: string; windows: PlanWindow[]; }
export interface PlanResult { planId: string; status: 'completed' | 'partial'; completedWindows: number; failedWindows: number; }
export interface PlanRepository {
  getPlan(id: string): Promise<PlanRecord | undefined>;
  updateWindow(id: string, patch: { status: string; lastError?: string }): Promise<void>;
  updatePlan(id: string, patch: { status: string; lastError?: string }): Promise<void>;
  listIncrementalPlans(now: Date): Promise<IncrementalPlan[]>;
  createWindow(input: Omit<PlanWindow, 'id' | 'status'>): Promise<PlanWindow>;
}
export type WindowExecutor = (window: PlanWindow) => Promise<unknown>;

function result(planId: string, completedWindows: number, failedWindows: number): PlanResult {
  return { planId, status: failedWindows ? 'partial' : 'completed', completedWindows, failedWindows };
}

export async function runInitialPlan(planId: string, repository: PlanRepository, execute: WindowExecutor): Promise<PlanResult> {
  const plan = await repository.getPlan(planId);
  if (!plan) throw new Error(`Sync plan not found: ${planId}`);
  let completedWindows = plan.windows.filter((window) => window.status === 'completed').length;
  let failedWindows = 0;
  for (const window of plan.windows.filter((item) => item.status !== 'completed')) {
    await repository.updateWindow(window.id, { status: 'running' });
    try {
      await execute(window);
      completedWindows += 1;
      await repository.updateWindow(window.id, { status: 'completed' });
    } catch (error) {
      failedWindows += 1;
      await repository.updateWindow(window.id, { status: 'failed', lastError: error instanceof Error ? error.message : String(error) });
    }
  }
  const summary = result(planId, completedWindows, failedWindows);
  await repository.updatePlan(planId, { status: summary.status, ...(failedWindows ? { lastError: 'one or more windows failed' } : {}) });
  return summary;
}

export async function runIncrementalPlans(now: Date, repository: PlanRepository, execute: WindowExecutor, maxConcurrentStores = 2): Promise<PlanResult[]> {
  const plans = await repository.listIncrementalPlans(now);
  const results: PlanResult[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < plans.length) {
      const plan = plans[cursor++];
      const from = new Date(now.getTime() - plan.overlapDays * 86_400_000).toISOString();
      const window = await repository.createWindow({ tenantId: plan.tenantId, storeId: plan.storeId, resource: plan.resource, batchId: `incremental:${plan.id}:${now.toISOString()}`, from, to: now.toISOString() });
      try {
        await repository.updateWindow(window.id, { status: 'running' });
        await execute(window);
        await repository.updateWindow(window.id, { status: 'completed' });
        results.push(result(plan.id, 1, 0));
      } catch (error) {
        await repository.updateWindow(window.id, { status: 'failed', lastError: error instanceof Error ? error.message : String(error) });
        results.push(result(plan.id, 0, 1));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(maxConcurrentStores, plans.length || 1)) }, () => worker()));
  return results;
}
