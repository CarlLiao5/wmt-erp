import { and, eq } from '../packages/db/src/repositories/index.js';
import { createDb, stores, syncJobs } from '../packages/db/index.js';
import { createSyncQueue, enqueueSync } from '../apps/worker/src/queue.js';

process.env.MYSQL_URL ??= 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';

const storeId = '001';
const resource = 'orders';
const { db, pool } = createDb();
const { queue, redis } = createSyncQueue();

try {
  const [store] = await db.select({ id: stores.id, tenantId: stores.tenantId, environment: stores.environment })
    .from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store || store.environment !== 'sandbox') throw new Error('Refusing to run: store 001 is not configured as Sandbox');

  const existing = await db.select({ id: syncJobs.id, status: syncJobs.status })
    .from(syncJobs).where(and(eq(syncJobs.tenantId, store.tenantId), eq(syncJobs.storeId, storeId), eq(syncJobs.resource, resource)));
  const pending = existing.find((job) => job.status === 'queued' || job.status === 'running');
  if (pending?.status === 'queued' || pending?.status === 'running') throw new Error(`Refusing duplicate: Sandbox orders job ${pending.id} is ${pending.status}`);

  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const created = await enqueueSync({ tenantId: store.tenantId, storeId, resource, window: { from, to } }, queue);
  const deadline = Date.now() + 10 * 60_000;
  let job: typeof syncJobs.$inferSelect | undefined;
  while (Date.now() < deadline) {
    [job] = await db.select().from(syncJobs).where(eq(syncJobs.idempotencyKey, created.jobId)).limit(1);
    if (job?.status === 'completed' || job?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!job || job.status !== 'completed' || !job.completedAt) {
    if (job?.status === 'failed') {
      const queueJob = await queue.getJob(created.jobId);
      const reason = queueJob?.failedReason ?? '';
      const failureStatus = reason.match(/(?:failed|request failed)\D{0,12}(\d{3})/i)?.[1] ?? null;
      const [rawRows] = await pool.query('SELECT COUNT(*) AS total FROM raw_payloads WHERE tenant_id = ? AND store_id = ? AND resource = ? AND received_at >= ?', [store.tenantId, storeId, resource, job.createdAt]) as any;
      console.log(JSON.stringify({ environment: store.environment, storeId, resource, status: job.status, failureType: reason.toLowerCase().includes('token') ? 'walmart_auth' : 'walmart_api', failureStatus, persistedRawPages: Number(rawRows?.[0]?.total ?? 0) }));
    }
    throw new Error(`Sandbox sync did not complete successfully (status=${job?.status ?? 'missing'})`);
  }

  const [rawRows] = await pool.query('SELECT COUNT(*) AS total FROM raw_payloads WHERE tenant_id = ? AND store_id = ? AND resource = ? AND received_at >= ?', [store.tenantId, storeId, resource, job.createdAt]) as any;
  const [orderRows] = await pool.query('SELECT COUNT(*) AS total FROM orders WHERE tenant_id = ? AND store_id = ? AND updated_at >= ?', [store.tenantId, storeId, job.createdAt]) as any;
  const rawPayloadRows = Number(rawRows?.[0]?.total ?? 0);
  const normalizedOrderRows = Number(orderRows?.[0]?.total ?? 0);
  if (rawPayloadRows === 0) throw new Error('Sandbox sync completed but no raw order response was persisted');

  console.log(JSON.stringify({ environment: store.environment, storeId, resource, status: job.status, attempts: job.attempts, completedAt: job.completedAt.toISOString(), rawPayloadRows, normalizedOrderRows }));
} finally {
  await queue.close();
  await redis.quit();
  await pool.end();
}
