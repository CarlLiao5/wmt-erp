import { randomUUID } from 'node:crypto';
import type { WalmartConnection } from '@walmart-erp/walmart-client';
import { walmartGet } from '@walmart-erp/walmart-client';
export interface SyncJob { tenantId: string; storeId: string; resource: string; window: { from: string; to: string }; cursor?: string; }
export interface SyncResult { resource: string; received: number; normalized: number; cursor?: string; correlationIds: string[]; }
export async function runSyncJob(job: SyncJob, connection: WalmartConnection, persist: (payload: unknown, correlationId: string) => Promise<void>, normalize: (payload: unknown) => Promise<number> = async () => 0): Promise<SyncResult> { const response = await walmartGet<unknown>(connection, `/v3/${job.resource}`, { query: { from: job.window.from, to: job.window.to } }); await persist(response.data, response.correlationId); const normalized = await normalize(response.data); return { resource: job.resource, received: 1, normalized, cursor: job.cursor ?? randomUUID(), correlationIds: [response.correlationId] }; }
