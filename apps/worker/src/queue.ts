import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
export interface SyncRequest { tenantId: string; storeId: string; resource: string; window: { from: string; to: string }; }
export interface JobRef { id: string; jobId: string; }
export function syncJobId(input: SyncRequest): string { return `sync:${input.storeId}:${input.resource}:${input.window.from}:${input.window.to}`; }
export function createSyncQueue(connection = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', queueName = 'walmart-sync') { const redis = new Redis(connection, { maxRetriesPerRequest: null }); return { queue: new Queue<SyncRequest>(queueName, { connection: redis }), redis }; }
export async function enqueueSync(input: SyncRequest, queue = createSyncQueue().queue): Promise<JobRef> { const jobId = syncJobId(input); const job = await queue.add(input.resource, input, { jobId, removeOnComplete: 100, removeOnFail: 100 } satisfies JobsOptions); return { id: job.id ?? jobId, jobId }; }
