import { createSyncWorker, defaultSyncQueueName, lingxingSyncQueueName, lingxingWorkerConcurrency, reportsSyncQueueName, syncQueueNameForResource } from './queue.js';
import { startIncrementalScheduler } from './sync/scheduler.js';

const { worker, redis, queue } = createSyncWorker(undefined, defaultSyncQueueName);
const reports = createSyncWorker(undefined, reportsSyncQueueName, undefined, 2);
const lingxing = createSyncWorker(undefined, lingxingSyncQueueName, undefined, lingxingWorkerConcurrency);
const weather = createSyncWorker(undefined, 'weather-sync', undefined, 1);
const heartbeatKey = 'wmterp:worker:heartbeat';
const writeHeartbeat = () => { void redis.set(heartbeatKey, String(Date.now()), 'EX', 30).catch((error) => console.error(`Worker heartbeat failed: ${error instanceof Error ? error.message : String(error)}`)); };
writeHeartbeat();
const heartbeatTimer = setInterval(writeHeartbeat, 10_000);
const queueForResource = (resource: string) => {
  const queueName = syncQueueNameForResource(resource);
  if (queueName === lingxingSyncQueueName) return lingxing.queue;
  if (queueName === reportsSyncQueueName) return reports.queue;
  if (queueName === 'weather-sync') return weather.queue;
  return queue;
};
const stopScheduler = startIncrementalScheduler(queue, undefined, queueForResource);
const shutdown = async () => { stopScheduler(); clearInterval(heartbeatTimer); await redis.del(heartbeatKey); await Promise.all([queue.close(), reports.queue.close(), lingxing.queue.close(), worker.close(), reports.worker.close(), lingxing.worker.close(), redis.quit(), reports.redis.quit(), lingxing.redis.quit()]); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
worker.on('failed', (job, error) => { console.error(`Sync job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
lingxing.worker.on('failed', (job, error) => { console.error(`Lingxing sync job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
weather.worker.on('failed', (job, error) => { console.error(`Weather job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
reports.worker.on('failed', (job, error) => { console.error(`Walmart report job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
