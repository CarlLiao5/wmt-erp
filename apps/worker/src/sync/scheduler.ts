import { enqueueDueProductReviewSchedules } from './product-reviews-scheduler.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { createDb } from '../../../../packages/db/index.js';
import { INCREMENTAL_SYNC_POLICIES, incrementalSyncPolicy, nextScheduledRunAt } from '../../../../packages/domain/src/syncPolicies.js';
import { enqueueSync, syncJobId, updateSyncWindow, type SyncRequest } from '../queue.js';
import type { SqlPool } from './scheduleStore.js';
import { enqueueDueBrightDataSchedules } from './brightdata-scheduler.js';

const SCHEDULER_INTERVAL_MS = 15_000;
const DUE_PLAN_LIMIT = 50;

interface DuePlan {
  id: string;
  tenantId: string;
  storeId: string;
  resource: string;
  intervalMinutes: number;
  overlapDays: number;
  nextRunAt: Date;
}

interface PendingWindow {
  id: string;
  tenantId: string;
  storeId: string;
  resource: string;
  batchId: string;
  windowFrom: Date;
  windowTo: Date;
  status: string;
}

function batchId(planId: string, scheduledAt: Date): string {
  return `inc:${createHash('sha256').update(`${planId}:${scheduledAt.toISOString()}`).digest('hex').slice(0, 32)}`;
}

export async function claimDuePlans(pool: SqlPool & { getConnection(): Promise<any> }, now: Date): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const resource of ['item-report', 'inventory-recon'] as const) {
      const policy = INCREMENTAL_SYNC_POLICIES[resource];
      await connection.query(
        `INSERT INTO sync_plans
          (id, tenant_id, store_id, resource, mode, status, interval_minutes, overlap_days, next_run_at, enabled, created_at, updated_at)
         SELECT UUID(), p.tenant_id, p.store_id, ?, 'incremental', 'planned', ?, ?, ?, 1, ?, ?
           FROM sync_plans p
          WHERE p.mode = 'incremental' AND p.enabled = 1 AND p.store_id <> '__tenant__'
            AND NOT EXISTS (
              SELECT 1 FROM sync_plans existing
               WHERE existing.tenant_id = p.tenant_id AND existing.store_id = p.store_id
                 AND existing.resource = ? AND existing.mode = 'incremental'
            )
          GROUP BY p.tenant_id, p.store_id`,
        [resource, policy.intervalMinutes, policy.overlapDays, nextScheduledRunAt(resource, now), now, now, resource],
      );
    }
    const lingxingPoCostPolicy = INCREMENTAL_SYNC_POLICIES['lingxing-head-freight-costs'];
    await connection.query(
      `INSERT INTO sync_plans
        (id, tenant_id, store_id, resource, mode, status, interval_minutes, overlap_days, next_run_at, enabled, created_at, updated_at)
       SELECT UUID(), p.tenant_id, '__tenant__', 'lingxing-head-freight-costs', 'incremental', 'planned', ?, ?, ?, 1, ?, ?
         FROM sync_plans p
        WHERE p.mode = 'incremental' AND p.enabled = 1 AND p.store_id = '__tenant__'
          AND p.resource IN ('head-freight', 'smart-sheet-allsku2026', 'freight-tracking', 'lingxing-advertising')
          AND NOT EXISTS (
            SELECT 1 FROM sync_plans existing
             WHERE existing.tenant_id = p.tenant_id AND existing.store_id = '__tenant__'
               AND existing.resource = 'lingxing-head-freight-costs' AND existing.mode = 'incremental'
          )
        GROUP BY p.tenant_id`,
      [lingxingPoCostPolicy.intervalMinutes, lingxingPoCostPolicy.overlapDays, nextScheduledRunAt('lingxing-head-freight-costs', now), now, now],
    );
    const [plans] = await connection.query(
      `SELECT id, tenant_id AS tenantId, store_id AS storeId, resource,
              interval_minutes AS intervalMinutes, overlap_days AS overlapDays, next_run_at AS nextRunAt
         FROM sync_plans
        WHERE mode = 'incremental' AND enabled = 1 AND next_run_at <= ?
        ORDER BY next_run_at ASC
        LIMIT ${DUE_PLAN_LIMIT}
        FOR UPDATE`,
      [now],
    );

    for (const plan of plans as DuePlan[]) {
      if (!incrementalSyncPolicy(plan.resource) || plan.intervalMinutes < 1 || (plan.resource !== 'weather' && plan.overlapDays < 1)) {
        await connection.query('UPDATE sync_plans SET enabled = 0, updated_at = ? WHERE id = ?', [now, plan.id]);
        continue;
      }
      const [pendingWindows] = await connection.query(
        `SELECT id FROM sync_windows
          WHERE plan_id = ? AND status IN ('planned', 'queued', 'running')
          LIMIT 1 FOR UPDATE`,
        [plan.id],
      );
      if ((pendingWindows as { id: string }[]).length > 0) continue;

      const scheduledAt = new Date(plan.nextRunAt);
      const from = plan.resource === 'inventory-recon'
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
        : new Date(now.getTime() - plan.overlapDays * 86_400_000);
      const to = plan.resource === 'inventory-recon'
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1)
        : now;
      const id = randomUUID();
      await connection.query(
        `INSERT INTO sync_windows
          (id, plan_id, tenant_id, store_id, resource, batch_id, window_from, window_to, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
        [id, plan.id, plan.tenantId, plan.storeId, plan.resource, batchId(plan.id, scheduledAt), from, to, now, now],
      );
      // Skip missed intervals instead of flooding the queue after a long outage.
      const nextRunAt = nextScheduledRunAt(plan.resource, now, scheduledAt, plan.intervalMinutes, plan.storeId);
      await connection.query('UPDATE sync_plans SET next_run_at = ?, updated_at = ? WHERE id = ?', [nextRunAt, now, plan.id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

type QueueResolver = (resource: string, storeId?: string) => Queue<SyncRequest>;

async function recoverAndEnqueue(pool: SqlPool, queueForResource: QueueResolver): Promise<void> {
  const [windows] = await pool.query(
    `SELECT w.id, w.tenant_id AS tenantId, w.store_id AS storeId, w.resource,
            w.batch_id AS batchId, w.window_from AS windowFrom, w.window_to AS windowTo, w.status
       FROM sync_windows w
       INNER JOIN sync_plans p ON p.id = w.plan_id
      WHERE p.mode = 'incremental' AND p.enabled = 1 AND w.status IN ('planned', 'queued', 'running')
      ORDER BY w.created_at ASC
      LIMIT 100`,
  );

  for (const window of windows as PendingWindow[]) {
    const queue = queueForResource(window.resource, window.storeId);
    const request: SyncRequest = {
      tenantId: window.tenantId,
      storeId: window.storeId,
      resource: window.resource,
      window: { from: new Date(window.windowFrom).toISOString(), to: new Date(window.windowTo).toISOString() },
      batchId: window.batchId,
      syncWindowId: window.id,
      ...(window.resource === 'inventory' ? { state: { shipmentMode: 'incremental' } } : {}),
    };
    const existing = await queue.getJob(syncJobId(request));
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        const status = state === 'completed' ? 'completed' : 'failed';
        await updateSyncWindow(pool, window.id, status, state === 'failed' ? 'BullMQ job failed before the schedule window was reconciled' : undefined);
        continue;
      }
      continue;
    }
    // A running DB window with no Redis job was lost; the deterministic job id makes re-enqueue idempotent.
    await enqueueSync(request, queue);
  }
}

export async function runSchedulerTick(queue: Queue<SyncRequest>, now = new Date(), queueForResource: QueueResolver = () => queue): Promise<void> {
  const { pool } = createDb();
  try {
    await enqueueDueProductReviewSchedules(pool, (request) => enqueueSync(request, queueForResource(request.resource, request.storeId)), now);
    await claimDuePlans(pool, now);
    await enqueueDueBrightDataSchedules(pool, (request) => enqueueSync(request, queueForResource(request.resource, request.storeId)), now);
    await recoverAndEnqueue(pool, queueForResource);
  } finally {
    await pool.end();
  }
}

export function startIncrementalScheduler(queue: Queue<SyncRequest>, intervalMs = SCHEDULER_INTERVAL_MS, queueForResource: QueueResolver = () => queue): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick(queue, new Date(), queueForResource);
    } catch (error) {
      console.error(`Incremental sync scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
