import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { createDecipheriv } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { and, createDb, credentials, eq, stores, syncJobs } from '../../../packages/db/index.js';
import type { WalmartConnection } from '@walmart-erp/walmart-client';
import { syncOrdersToDatabase, syncReturnsToDatabase } from './jobs/commerceRawStore.js';
import { syncWfsToDatabase } from './jobs/syncWfs.js';
import { syncStorageFeesToDatabase } from './jobs/syncStorageFees.js';
import { syncAdvertisingToDatabase, syncPerformanceToDatabase, syncPricingToDatabase, syncSemItemAdvertisingToDatabase, syncSemPerformanceToDatabase, syncSemSearchTermsToDatabase } from './jobs/syncMarketing.js';
import { loadWecomHeadFreightConfig, syncHeadFreightToDatabase, syncSmartSheetRecordsToRawPayloads } from './jobs/syncHeadFreight.js';
import { summarizePlanWindows } from './sync/planProgress.js';
import { syncItemReportToDatabase } from './jobs/syncItemReport.js';
import { BRIGHTDATA_RESOURCE, syncBrightDataInventory } from './jobs/syncBrightData.js';
import { syncFreightTracking } from './jobs/syncFreightTracking.js';
import { runLingxingAdvertising } from './jobs/syncLingxingAdvertising.js';
import { runLingxingHeadFreightCosts } from './jobs/syncLingxingHeadFreightCosts.js';
import { syncWeatherToDatabase } from './jobs/syncWeather.js';
export interface SyncRequest { tenantId: string; storeId: string; resource: string; window: { from: string; to: string }; batchId?: string; syncWindowId?: string; state?: any; period?: string; }
export interface JobRef { id: string; jobId: string; }
export const syncWorkerConcurrency = 4;
export const lingxingWorkerConcurrency = 1;
export const defaultSyncQueueName = 'walmart-sync';
export const reportsSyncQueueName = 'walmart-sync-reports';
export const lingxingSyncQueueName = 'walmart-sync-lingxing';
export const weatherQueueName = 'weather-sync';
export const weatherWorkerConcurrency = 1;
const reportResources = new Set(['storage-fees', 'advertising-sem-performance', 'advertising-sem-search-terms', 'item-report']);
export function syncQueueNameForResource(resource: string): string {
  if (resource === 'weather') return weatherQueueName;
  if (resource === 'lingxing-advertising' || resource === 'lingxing-head-freight-costs') return lingxingSyncQueueName;
  if (reportResources.has(resource)) return reportsSyncQueueName;
  return defaultSyncQueueName;
}
export function completedSyncJobUpdate(completedAt = new Date(), resultPayload?: unknown) { return resultPayload === undefined ? { status: 'completed', completedAt } as const : { status: 'completed', completedAt, resultPayload: structuredClone(resultPayload) } as const; }
export function syncJobId(input: SyncRequest): string { return `sync:${input.storeId}:${input.resource}:${input.window.from}:${input.window.to}:${input.batchId ?? randomUUID()}`; }
export function createSyncQueue(connection = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', queueName = 'walmart-sync') { const redis = new Redis(connection, { maxRetriesPerRequest: null }); return { queue: new Queue<SyncRequest>(queueName, { connection: redis }), redis }; }
async function refreshPlanStatus(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, planId: string): Promise<void> {
  const [rows] = await pool.query('SELECT status, window_from AS windowFrom, window_to AS windowTo FROM sync_windows WHERE plan_id = ?', [planId]) as [{ status: string; windowFrom: Date; windowTo: Date }[], unknown];
  const progress = summarizePlanWindows(rows.map((row) => row.status));
  const coverageFrom = rows.length ? rows.reduce((min, row) => row.windowFrom < min ? row.windowFrom : min, rows[0].windowFrom) : null;
  const coverageTo = rows.length ? rows.reduce((max, row) => row.windowTo > max ? row.windowTo : max, rows[0].windowTo) : null;
  await pool.query('UPDATE sync_plans SET status = ?, coverage_from = ?, coverage_to = ?, updated_at = ? WHERE id = ?', [progress.status, coverageFrom, coverageTo, new Date(), planId]);
}

export async function updateSyncWindow(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, syncWindowId: string | undefined, status: string, lastError?: string): Promise<void> {
  if (!syncWindowId) return;
  await pool.query('UPDATE sync_windows SET status = ?, last_error = ?, updated_at = ? WHERE id = ?', [status, lastError ?? null, new Date(), syncWindowId]);
  const [rows] = await pool.query('SELECT plan_id AS planId FROM sync_windows WHERE id = ?', [syncWindowId]) as [{ planId: string }[], unknown];
  if (rows[0]) await refreshPlanStatus(pool, rows[0].planId);
}

export async function enqueueSync(input: SyncRequest, queue = createSyncQueue().queue): Promise<JobRef> {
  const request = { ...input, batchId: input.batchId ?? randomUUID() };
  const jobId = syncJobId(request);
  if (process.env.MYSQL_URL) {
    const { db, pool } = createDb();
    try {
      await db.insert(syncJobs).values({ id: randomUUID(), tenantId: request.tenantId, storeId: request.storeId, resource: request.resource, syncWindowId: request.syncWindowId, idempotencyKey: jobId, status: 'queued', attempts: 0, availableAt: new Date(), createdAt: new Date() }).onDuplicateKeyUpdate({ set: { availableAt: new Date(), status: 'queued', syncWindowId: request.syncWindowId } });
      await updateSyncWindow(pool, request.syncWindowId, 'queued');
    } finally {
      await pool.end();
    }
  }
  const job = await queue.add(request.resource, request, { jobId, removeOnComplete: 100, removeOnFail: 100 } satisfies JobsOptions);
  return { id: job.id ?? jobId, jobId };
}

export type ConnectionLoader = (request: SyncRequest) => Promise<WalmartConnection>;
export interface CommerceSyncHandlers { inventory?: (window: { tenantId: string; storeId: string; from: string; to: string; batchId?: string }, connection: WalmartConnection) => Promise<unknown>; orders: (window: { tenantId: string; storeId: string; from: string; to: string }, connection: WalmartConnection) => Promise<unknown>; returns: (window: { tenantId: string; storeId: string; from: string; to: string }, connection: WalmartConnection) => Promise<unknown>; brightdata?: (window: { tenantId: string; runId: string }) => Promise<unknown>; headFreight?: (window: { tenantId: string; from: string; to: string; batchId: string }, connection?: WalmartConnection) => Promise<unknown>; allSku?: (window: { tenantId: string; from: string; to: string; batchId: string }, connection?: WalmartConnection) => Promise<unknown>; freightTracking?: (window: { tenantId: string; batchId: string }) => Promise<unknown>; }
export async function processSyncRequest(request: SyncRequest, loadConnection: ConnectionLoader = mysqlConnectionLoader, handlers: CommerceSyncHandlers = { orders: syncOrdersToDatabase, returns: syncReturnsToDatabase, inventory: syncWfsToDatabase, brightdata: async (window) => syncBrightDataInventory(window.tenantId, window.runId), headFreight: async (window) => syncHeadFreightToDatabase(window, await loadWecomHeadFreightConfig(window.tenantId)), allSku: async (window) => { const config = await loadWecomHeadFreightConfig(window.tenantId); return syncSmartSheetRecordsToRawPayloads({ ...window, documentUrl: config.documentUrl, tableId: 'tT8wpu', resource: 'wecom-smartsheet:ALLSKU2026' }, config); }, freightTracking: async (window) => syncFreightTracking(window) }): Promise<unknown> {
  if (request.resource === 'weather') return syncWeatherToDatabase({ state: request.state, period: request.period as any });
  if (request.resource !== 'orders' && request.resource !== 'returns' && request.resource !== 'inventory' && request.resource !== 'storage-fees' && request.resource !== 'pricing' && request.resource !== 'item-report' && request.resource !== 'advertising' && request.resource !== 'advertising-onsite' && request.resource !== 'advertising-sem' && request.resource !== 'advertising-sem-items' && request.resource !== 'advertising-sem-performance' && request.resource !== 'advertising-sem-search-terms' && request.resource !== 'performance' && request.resource !== 'head-freight' && request.resource !== 'smart-sheet-allsku2026' && request.resource !== BRIGHTDATA_RESOURCE && request.resource !== 'freight-tracking' && request.resource !== 'lingxing-advertising' && request.resource !== 'lingxing-head-freight-costs') throw new Error(`Unsupported commerce sync resource: ${request.resource}`);
  if (request.resource === 'head-freight') { if (!handlers.headFreight) throw new Error('Head freight sync handler is not configured'); return handlers.headFreight({ tenantId: request.tenantId, from: request.window.from, to: request.window.to, batchId: request.batchId ?? randomUUID() }); }
  if (request.resource === 'smart-sheet-allsku2026') { if (!handlers.allSku) throw new Error('ALLSKU2026 sync handler is not configured'); return handlers.allSku({ tenantId: request.tenantId, from: request.window.from, to: request.window.to, batchId: request.batchId ?? randomUUID() }); }
  if (request.resource === BRIGHTDATA_RESOURCE) { if (!handlers.brightdata) throw new Error('Bright Data sync handler is not configured'); return handlers.brightdata({ tenantId: request.tenantId, runId: request.batchId ?? randomUUID() }); }
  if (request.resource === 'freight-tracking') { if (!handlers.freightTracking) throw new Error('Freight tracking sync handler is not configured'); return handlers.freightTracking({ tenantId: request.tenantId, batchId: request.batchId ?? randomUUID() }); }
  if (request.resource === 'lingxing-advertising') return runLingxingAdvertising({ tenantId: request.tenantId, from: request.window.from, to: request.window.to, batchId: request.batchId });
  if (request.resource === 'lingxing-head-freight-costs') return runLingxingHeadFreightCosts({ tenantId: request.tenantId, batchId: request.batchId ?? randomUUID() });
  const connection = await loadConnection(request);
  if (request.resource === 'inventory') { if (!handlers.inventory) throw new Error('Inventory sync handler is not configured'); return handlers.inventory({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection); }
  if (request.resource === 'storage-fees') return syncStorageFeesToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to }, connection);
  if (request.resource === 'pricing') return syncPricingToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection);
  if (request.resource === 'item-report') return syncItemReportToDatabase({ tenantId: request.tenantId, storeId: request.storeId }, connection);
  if (request.resource === 'advertising' || request.resource === 'advertising-onsite' || request.resource === 'advertising-sem') return syncAdvertisingToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection, request.resource === 'advertising-sem' ? 'sem' : 'onsite');
  if (request.resource === 'advertising-sem-items') return syncSemItemAdvertisingToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection);
  if (request.resource === 'advertising-sem-performance') return syncSemPerformanceToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection);
  if (request.resource === 'advertising-sem-search-terms') return syncSemSearchTermsToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection);
  if (request.resource === 'performance') return syncPerformanceToDatabase({ tenantId: request.tenantId, storeId: request.storeId, from: request.window.from, to: request.window.to, batchId: request.batchId }, connection);
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

export function createSyncWorker(connection = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', queueName = defaultSyncQueueName, processor: (request: SyncRequest) => Promise<unknown> = processSyncRequest, concurrency = syncWorkerConcurrency) {
  const redis = new Redis(connection, { maxRetriesPerRequest: null });
  const worker = new Worker<SyncRequest>(queueName, async (job) => {
    const { db, pool } = createDb();
    try { await db.update(syncJobs).set({ status: 'running', attempts: (job.attemptsMade ?? 0) + 1 }).where(eq(syncJobs.idempotencyKey, syncJobId(job.data))); await updateSyncWindow(pool, job.data.syncWindowId, 'running'); } finally { await pool.end(); }
    try { const result = await processor(job.data); const { db: doneDb, pool: donePool } = createDb(); try { await doneDb.update(syncJobs).set(completedSyncJobUpdate(new Date(), result)).where(eq(syncJobs.idempotencyKey, syncJobId(job.data))); await updateSyncWindow(donePool, job.data.syncWindowId, 'completed'); } finally { await donePool.end(); } return result; }
    catch (error) { const { db: failDb, pool: failPool } = createDb(); try { const message = error instanceof Error ? error.message : '同步失败'; await failDb.update(syncJobs).set({ status: 'failed', completedAt: null, resultPayload: { error: message } }).where(eq(syncJobs.idempotencyKey, syncJobId(job.data))); await updateSyncWindow(failPool, job.data.syncWindowId, 'failed', message); } finally { await failPool.end(); } throw error; }
  }, { connection: redis, concurrency });
  const queue = new Queue<SyncRequest>(queueName, { connection: redis });
  return { worker, redis, queue };
}
