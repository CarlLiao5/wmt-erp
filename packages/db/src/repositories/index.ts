import { and, asc, eq, gt, gte, inArray, isNull, like, lt, lte, or } from 'drizzle-orm';
import type { AppDatabase } from '../db.js';
import { inventorySnapshots, orders, rawPayloads, skus, syncCursors, syncJobs, stores } from '../schema/index.js';
export async function listStores(db: AppDatabase, tenantId: string) { return db.select().from(stores).where(eq(stores.tenantId, tenantId)).orderBy(asc(stores.name)); }
export async function createStore(db: AppDatabase, value: typeof stores.$inferInsert) { await db.insert(stores).values(value); return value; }

export async function upsertRawPayload(db: AppDatabase, value: typeof rawPayloads.$inferInsert) {
  const scope = value.storeId == null ? isNull(rawPayloads.storeId) : eq(rawPayloads.storeId, value.storeId);
  const existing = await db.select({ id: rawPayloads.id }).from(rawPayloads).where(and(scope, eq(rawPayloads.resource, value.resource), eq(rawPayloads.externalId, value.externalId))).limit(1);
  if (existing.length) return existing[0];
  return db.insert(rawPayloads).values(value).$returningId();
}

export async function upsertSku(db: AppDatabase, value: typeof skus.$inferInsert) {
  await db.insert(skus).values(value).onDuplicateKeyUpdate({ set: { itemId: value.itemId, title: value.title, description: value.description, brand: value.brand, productType: value.productType, lifecycleStatus: value.lifecycleStatus, publishedStatus: value.publishedStatus, availability: value.availability, gtin: value.gtin, variantGroupId: value.variantGroupId, imageUrl: value.imageUrl, isDuplicate: value.isDuplicate, isCustomerFavorite: value.isCustomerFavorite, details: value.details, updatedAt: value.updatedAt } });
}

export async function upsertOrder(db: AppDatabase, value: typeof orders.$inferInsert) {
  await db.insert(orders).values(value).onDuplicateKeyUpdate({ set: { status: value.status, totalAmount: value.totalAmount, updatedAt: value.updatedAt } });
}

export async function appendInventorySnapshot(db: AppDatabase, value: typeof inventorySnapshots.$inferInsert) {
  return db.insert(inventorySnapshots).values(value).onDuplicateKeyUpdate({ set: { idempotencyKey: value.idempotencyKey } });
}

export async function getSyncCursor(db: AppDatabase, storeId: string, resource: string) {
  return db.select().from(syncCursors).where(and(eq(syncCursors.storeId, storeId), eq(syncCursors.resource, resource))).limit(1);
}

export async function advanceSyncCursor(db: AppDatabase, storeId: string, resource: string, cursor: string, tenantId: string, updatedAt: Date) {
  const current = await getSyncCursor(db, storeId, resource);
  if (current[0]?.cursor && cursor <= current[0].cursor) return current[0];
  if (current.length) {
    await db.update(syncCursors).set({ cursor, updatedAt }).where(and(eq(syncCursors.storeId, storeId), eq(syncCursors.resource, resource)));
    return { ...current[0], cursor, updatedAt };
  }
  await db.insert(syncCursors).values({ tenantId, storeId, resource, cursor, updatedAt });
  return { tenantId, storeId, resource, cursor, updatedAt };
}

export async function createSyncJob(db: AppDatabase, value: typeof syncJobs.$inferInsert) {
  await db.insert(syncJobs).values(value).onDuplicateKeyUpdate({ set: { availableAt: value.availableAt } });
  return value.id;
}

export { and, asc, eq, gt, gte, inArray, like, lt, lte, or };
