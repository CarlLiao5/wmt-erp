import { createHash } from 'node:crypto';
import type { SyncRequest, JobRef } from '../queue.js';
import { brightDataScheduleDay, nextBrightDataRunAt } from '../../../../packages/domain/index.js';

interface ScheduleSqlConnection {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

interface ScheduleSqlPool { getConnection(): Promise<ScheduleSqlConnection>; }
interface DueSchedule { tenantId: string; nextRunAt: Date; }
type EnqueueScheduleJob = (request: SyncRequest) => Promise<JobRef>;

export function brightDataScheduleBatchId(tenantId: string, scheduledAt: Date): string {
  const tenantKey = createHash('sha256').update(tenantId).digest('hex').slice(0, 10);
  return `daily:${tenantKey}:${brightDataScheduleDay(scheduledAt)}`;
}

export async function enqueueDueBrightDataSchedules(pool: ScheduleSqlPool, enqueue: EnqueueScheduleJob, now: Date): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT tenant_id AS tenantId, next_run_at AS nextRunAt
         FROM brightdata_sync_schedules
        WHERE enabled = 1 AND next_run_at <= ?
        ORDER BY next_run_at ASC
        LIMIT 50
        FOR UPDATE`,
      [now],
    );
    for (const row of rows as DueSchedule[]) {
      const scheduledAt = new Date(row.nextRunAt);
      const request: SyncRequest = {
        tenantId: row.tenantId,
        storeId: '__tenant__',
        resource: 'brightdata-inventory',
        window: { from: scheduledAt.toISOString(), to: scheduledAt.toISOString() },
        batchId: brightDataScheduleBatchId(row.tenantId, scheduledAt),
      };
      await enqueue(request);
      await connection.query(
        `UPDATE brightdata_sync_schedules
            SET last_run_at = ?, next_run_at = ?, updated_at = ?
          WHERE tenant_id = ? AND enabled = 1`,
        [scheduledAt, nextBrightDataRunAt(now), now, row.tenantId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
