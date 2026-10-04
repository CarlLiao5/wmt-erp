import { runSyncJob, type SyncJob, type SyncResult } from '../sync.js';
export const resource = 'items';
export function syncItems(job: Omit<SyncJob, 'resource'>, ...args: Parameters<typeof runSyncJob> extends [SyncJob, ...infer R] ? R : never): Promise<SyncResult> { return runSyncJob({ ...job, resource }, ...args); }

export interface NormalizedItem {
  id: string;
  storeId: string;
  tenantId?: string;
  sku: string;
  itemId?: string;
  title?: string;
  updatedAt: Date;
}

/** Converts the varying v3/items envelopes into stable, store-scoped records. */
export function normalizeItemPayload(payload: unknown, context: { storeId: string; tenantId?: string; now?: Date }): NormalizedItem[] {
  const envelope = payload as { items?: unknown[]; data?: unknown[] } | null;
  const values = Array.isArray(envelope) ? envelope : Array.isArray(envelope?.items) ? envelope.items : Array.isArray(envelope?.data) ? envelope.data : [];
  const now = context.now ?? new Date();
  return values.flatMap((value): NormalizedItem[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const sku = String(row.sku ?? row.SKU ?? row.productId ?? row.itemId ?? '').trim();
    if (!sku) return [];
    const id = String(row.id ?? row.itemId ?? sku);
    const titleValue = row.title ?? row.productName ?? row.name;
    return [{ id, storeId: context.storeId, tenantId: context.tenantId, sku, itemId: typeof row.itemId === 'string' ? row.itemId : undefined, title: typeof titleValue === 'string' ? titleValue : undefined, updatedAt: now }];
  });
}

export async function upsertNormalizedItems(items: NormalizedItem[], upsert: (item: NormalizedItem) => Promise<unknown>): Promise<number> {
  for (const item of items) await upsert(item);
  return items.length;
}
