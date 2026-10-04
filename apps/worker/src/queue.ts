import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { createDecipheriv } from 'node:crypto';
import { and, createDb, credentials, eq, stores } from '../../../packages/db/index.js';
import type { WalmartConnection } from '@walmart-erp/walmart-client';
import { syncOrdersToDatabase, syncReturnsToDatabase } from './jobs/commerceRawStore.js';
export interface SyncRequest { tenantId: string; storeId: string; resource: string; window: { from: string; to: string }; }
export interface JobRef { id: string; jobId: string; }
export function syncJobId(input: SyncRequest): string { return `sync:${input.storeId}:${input.resource}:${input.window.from}:${input.window.to}`; }
export function createSyncQueue(connection = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', queueName = 'walmart-sync') { const redis = new Redis(connection, { maxRetriesPerRequest: null }); return { queue: new Queue<SyncRequest>(queueName, { connection: redis }), redis }; }
export async function enqueueSync(input: SyncRequest, queue = createSyncQueue().queue): Promise<JobRef> { const jobId = syncJobId(input); const job = await queue.add(input.resource, input, { jobId, removeOnComplete: 100, removeOnFail: 100 } satisfies JobsOptions); return { id: job.id ?? jobId, jobId }; }

export type ConnectionLoader = (request: SyncRequest) => Promise<WalmartConnection>;
export interface CommerceSyncHandlers { orders: (window: { tenantId: string; storeId: string; from: string; to: string }, connection: WalmartConnection) => Promise<unknown>; returns: (window: { tenantId: string; storeId: string; from: string; to: string }, connection: WalmartConnection) => Promise<unknown>; }
export async function processSyncRequest(request: SyncRequest, loadConnection: ConnectionLoader = mysqlConnectionLoader, handlers: CommerceSyncHandlers = { orders: syncOrdersToDatabase, returns: syncReturnsToDatabase }): Promise<unknown> {
  if (request.resource !== 'orders' && request.resource !== 'returns') throw new Error(`Unsupported commerce sync resource: ${request.resource}`);
  const connection = await loadConnection(request);
  return handlers[request.resource]({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to }, connection);
}

function decrypt(value: string): string {
  const keyValue = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyValue) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be configured');
  const key = /^[a-f0-9]{64}$/i.test(keyValue) ? Buffer.from(keyValue, 'hex') : Buffer.from(keyValue, 'utf8');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes or 64 hexadecimal characters');
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted credential format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export async function mysqlConnectionLoader(request: SyncRequest): Promise<WalmartConnection> {
  const { db, pool } = createDb();
  try {
    const [row] = await db.select({ environment: stores.environment, encryptedClientId: credentials.encryptedClientId, encryptedSecret: credentials.encryptedSecret }).from(stores).innerJoin(credentials, and(eq(credentials.storeId, stores.id), eq(credentials.tenantId, stores.tenantId))).where(and(eq(stores.id, request.storeId), eq(stores.tenantId, request.tenantId))).limit(1);
    if (!row || (row.environment !== 'sandbox' && row.environment !== 'production')) throw new Error('Store credentials or environment are not configured');
    return { clientId: decrypt(row.encryptedClientId), clientSecret: decrypt(row.encryptedSecret), environment: row.environment, baseUrl: row.environment === 'sandbox' ? process.env.WALMART_SANDBOX_BASE_URL ?? 'https://sandbox.walmartapis.com' : process.env.WALMART_PRODUCTION_BASE_URL ?? 'https://marketplace.walmartapis.com' };
  } finally { await pool.end(); }
}

export function createSyncWorker(connection = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', queueName = 'walmart-sync', processor: (request: SyncRequest) => Promise<unknown> = processSyncRequest) {
  const redis = new Redis(connection, { maxRetriesPerRequest: null });
  const worker = new Worker<SyncRequest>(queueName, async (job) => processor(job.data), { connection: redis });
  return { worker, redis };
}
