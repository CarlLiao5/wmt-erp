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
  description?: string; brand?: string; productType?: string; lifecycleStatus?: string; publishedStatus?: string; availability?: string; gtin?: string; variantGroupId?: string; imageUrl?: string; isDuplicate?: boolean; isCustomerFavorite?: boolean; details?: Record<string, unknown>;
  updatedAt: Date;
}

/** Converts the varying v3/items envelopes into stable, store-scoped records. */
export function normalizeItemPayload(payload: unknown, context: { storeId: string; tenantId?: string; now?: Date }): NormalizedItem[] {
  const envelope = payload as { items?: unknown[]; data?: unknown[] } | null;
  const values = Array.isArray(envelope) ? envelope : Array.isArray(envelope?.items) ? envelope.items : Array.isArray(envelope?.data) ? envelope.data : (envelope && typeof envelope === 'object' && ('sku' in envelope || 'itemId' in envelope || 'productName' in envelope || 'productId' in envelope) ? [envelope] : []);
  const now = context.now ?? new Date();
  return values.flatMap((value): NormalizedItem[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const nestedItem = row.item && typeof row.item === 'object' ? row.item as Record<string, unknown> : {};
    const sku = String(row.sku ?? row.SKU ?? row.productId ?? row.itemId ?? nestedItem.sku ?? nestedItem.SKU ?? nestedItem.productId ?? nestedItem.itemId ?? '').trim();
    if (!sku) return [];
    const itemIdValue = row.itemId ?? row.itemID ?? row.item_id ?? row.productId ?? nestedItem.itemId ?? nestedItem.itemID ?? nestedItem.item_id ?? nestedItem.productId ?? row.wpid ?? nestedItem.wpid ?? row.id ?? nestedItem.id;
    const externalId = String(row.id ?? itemIdValue ?? sku);
    const id = `${context.storeId}:${externalId}`;
    const titleValue = row.title ?? row.productName ?? row.name ?? nestedItem.title ?? nestedItem.productName ?? nestedItem.name;
    const text = (...keys: string[]) => { for (const key of keys) { const value = row[key] ?? nestedItem[key]; if (typeof value === 'string' && value.trim()) return value.trim(); } return undefined; };
    const bool = (...keys: string[]) => { for (const key of keys) { const value = row[key] ?? nestedItem[key]; if (typeof value === 'boolean') return value; } return undefined; };
    return [{ id, storeId: context.storeId, tenantId: context.tenantId, sku, itemId: itemIdValue == null ? undefined : String(itemIdValue), title: typeof titleValue === 'string' ? titleValue : undefined, description: text('description','shortDescription'), brand: text('brand'), productType: text('productType','product_type'), lifecycleStatus: text('lifecycleStatus','lifecycle_status'), publishedStatus: text('publishedStatus','published_status'), availability: text('availability'), gtin: text('gtin','GTIN','upc','UPC'), variantGroupId: text('variantGroupId','variant_group_id'), imageUrl: text('imageUrl','image','mainImageUrl'), isDuplicate: bool('isDuplicate'), isCustomerFavorite: bool('isCustomerFavorite'), details: row, updatedAt: now }];
  });
}

export async function upsertNormalizedItems(items: NormalizedItem[], upsert: (item: NormalizedItem) => Promise<unknown>): Promise<number> {
  const unique = new Map(items.map((item) => [`${item.storeId}:${item.sku}`, item]));
  for (const item of unique.values()) await upsert(item);
  return unique.size;
}
