import { startProfitScheduler } from './sync/profit-scheduler.js';
import { createSyncWorker, defaultSyncQueueName, lingxingSyncQueueName, lingxingWorkerConcurrency, reportQueueNameForStore, reportsSyncQueueName, syncErrorMessage, syncQueueNameForResource, weatherQueueName } from './queue.js';
import { startIncrementalScheduler } from './sync/scheduler.js';

const { worker, redis, queue } = createSyncWorker(undefined, defaultSyncQueueName);
const reportConcurrency = Math.max(1, Math.min(2, Number(process.env.REPORT_WORKER_CONCURRENCY) || 2));
const reports = createSyncWorker(undefined, reportsSyncQueueName, undefined, reportConcurrency);
const reportStores = ['10001133528', '10001156838', '10001578336', '10002512034', 'prod-001'];
const reportStoreWorkers = reportStores.map((storeId) => ({ storeId, ...createSyncWorker(undefined, reportQueueNameForStore(storeId), undefined, reportConcurrency) }));
const lingxing = createSyncWorker(undefined, lingxingSyncQueueName, undefined, lingxingWorkerConcurrency);
const weather = createSyncWorker(undefined, weatherQueueName, undefined, 1);
const reviews = createSyncWorker(undefined, 'product-reviews-sync', undefined, 1);
const heartbeatKey = 'wmterp:worker:heartbeat';
const writeHeartbeat = () => { void redis.set(heartbeatKey, String(Date.now()), 'EX', 30).catch((error) => console.error(`Worker heartbeat failed: ${error instanceof Error ? error.message : String(error)}`)); };
writeHeartbeat();
const heartbeatTimer = setInterval(writeHeartbeat, 10_000);
const queueForResource = (resource: string, storeId?: string) => {
  const queueName = syncQueueNameForResource(resource);
  if (queueName === lingxingSyncQueueName) return lingxing.queue;
  if (queueName === reportsSyncQueueName && storeId) return reportStoreWorkers.find((item) => item.storeId === storeId)?.queue ?? reports.queue;
  if (queueName === reportsSyncQueueName) return reports.queue;
  if (queueName === 'product-reviews-sync') return reviews.queue;
  if (queueName === weatherQueueName) return weather.queue;
  return queue;
};
const stopScheduler = startIncrementalScheduler(queue, undefined, queueForResource);
const stopProfitScheduler = startProfitScheduler();
const shutdown = async () => { stopScheduler(); const profitShutdown = stopProfitScheduler(); clearInterval(heartbeatTimer); await redis.del(heartbeatKey); await Promise.all([profitShutdown, reviews.queue.close(), reviews.worker.close(), reviews.redis.quit(), queue.close(), reports.queue.close(), lingxing.queue.close(), weather.queue.close(), worker.close(), reports.worker.close(), lingxing.worker.close(), weather.worker.close(), ...reportStoreWorkers.flatMap((item) => [item.queue.close(), item.worker.close(), item.redis.quit()]), redis.quit(), reports.redis.quit(), lingxing.redis.quit(), weather.redis.quit()]); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
worker.on('failed', (job, error) => { console.error(`Sync job ${job?.id ?? 'unknown'} failed: ${syncErrorMessage(error)}`); });
lingxing.worker.on('failed', (job, error) => { console.error(`Lingxing sync job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
weather.worker.on('failed', (job, error) => { console.error(`Weather job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
reports.worker.on('failed', (job, error) => { console.error(`Walmart report job ${job?.id ?? 'unknown'} failed: ${error.message}`); });

reviews.worker.on('failed', (job, error) => console.error(`Product reviews job ${job?.id ?? 'unknown'} failed: ${syncErrorMessage(error)}`));
