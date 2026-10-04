import { createSyncWorker } from './queue.js';

const { worker, redis } = createSyncWorker();
const shutdown = async () => { await worker.close(); await redis.quit(); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
worker.on('failed', (job, error) => { console.error(`Sync job ${job?.id ?? 'unknown'} failed: ${error.message}`); });
