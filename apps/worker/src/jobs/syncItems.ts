import { runSyncJob, type SyncJob, type SyncResult } from '../sync.js';
export const resource = 'items';
export function syncItems(job: Omit<SyncJob, 'resource'>, ...args: Parameters<typeof runSyncJob> extends [SyncJob, ...infer R] ? R : never): Promise<SyncResult> { return runSyncJob({ ...job, resource }, ...args); }
