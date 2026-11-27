import { createHash, randomUUID } from 'node:crypto';
import { and, brightdataItemNames, brightdataProductInventory, brightdataRunHistory, createDb, eq } from '../../../../packages/db/index.js';
import { brightDataIntervalMs, fetchBrightDataProduct, type BrightDataConfig } from '@walmart-erp/walmart-client';
import type { AppDatabase } from '../../../../packages/db/src/db.js';

export const BRIGHTDATA_RESOURCE = 'brightdata-inventory' as const;
type Database = AppDatabase;
type Delay = (milliseconds: number) => Promise<void>;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export interface BrightDataSyncOptions {
  db?: Database;
  fetcher?: typeof fetch;
  delay?: Delay;
  requestDelay?: Delay;
  config?: BrightDataConfig;
  urlForItem?: (itemId: string) => string;
  now?: () => Date;
  concurrency?: number;
}
export interface BrightDataSyncResult { total: number; success: number; failed: number; }

export function brightDataConfigFromEnvironment(): BrightDataConfig {
  return {
    apiKey: process.env.BRIGHTDATA_API_KEY ?? '',
    zone: process.env.BRIGHTDATA_ZONE ?? '',
    endpoint: process.env.BRIGHTDATA_ENDPOINT,
    timeoutMs: process.env.BRIGHTDATA_TIMEOUT_MS ? Number(process.env.BRIGHTDATA_TIMEOUT_MS) : undefined,
    intervalMs: process.env.BRIGHTDATA_INTERVAL_MS ? Number(process.env.BRIGHTDATA_INTERVAL_MS) : undefined,
    maxRetries: process.env.BRIGHTDATA_MAX_RETRIES ? Number(process.env.BRIGHTDATA_MAX_RETRIES) : undefined,
  };
}
function itemUrl(itemId: string): string {
  const template = process.env.BRIGHTDATA_ITEM_URL_TEMPLATE ?? 'https://business.walmart.com/ip/{itemId}';
  return template.replaceAll('{itemId}', encodeURIComponent(itemId));
}
function idempotencyKey(runId: string, itemId: string): string {
  return createHash('sha256').update(`${runId}:${itemId}`).digest('hex');
}
function valueOrNull(value: number | null): string | null { return value == null ? null : String(value); }

export async function syncBrightDataInventory(tenantId: string, runId: string, options: BrightDataSyncOptions = {}): Promise<BrightDataSyncResult> {
  const owned = !options.db;
  const context = options.db ? { db: options.db, pool: undefined } : createDb();
  const db = context.db;
  const now = options.now ?? (() => new Date());
  const config = options.config ?? brightDataConfigFromEnvironment();
  const intervalMs = brightDataIntervalMs(config);
  const pause = options.requestDelay ?? options.delay ?? wait;
  const errors: string[] = [];
  const startedAt = now();
  try {
    await db.insert(brightdataRunHistory).values({ runId, tenantId, startedAt, status: 'running', totalItems: 0, successCount: 0, failCount: 0 }).onDuplicateKeyUpdate({ set: { status: 'running', startedAt, endedAt: null, errorMessage: null } });
    const sourceRows = await db.select({ id: brightdataItemNames.id, itemId: brightdataItemNames.itemId, storeId: brightdataItemNames.storeId }).from(brightdataItemNames).where(eq(brightdataItemNames.tenantId, tenantId));
    const items = [...new Map(sourceRows.map((row) => [String(row.itemId ?? '').trim(), row])).values()].filter((row) => String(row.itemId ?? '').trim());
    let success = 0;
    let failed = 0;
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? Number(process.env.BRIGHTDATA_CONCURRENCY ?? 10)));
    const processItem = async (source: (typeof items)[number]) => {
      const itemId = String(source.itemId).trim();
      try {
        const product = await fetchBrightDataProduct(itemId, (options.urlForItem ?? itemUrl)(itemId), config, options.fetcher, options.delay);
        const timestamp = now();
        const values = { id: randomUUID(), tenantId, storeId: source.storeId ?? null, sourceItemId: source.id, itemId, runId, productName: product.productName, availableQuantity: product.availableQuantity, queriedAt: timestamp, price: valueOrNull(product.price), description: product.description, rating: valueOrNull(product.rating), reviewCount: product.reviewCount, rawPayload: product.rawPayload, idempotencyKey: idempotencyKey(runId, itemId), createdAt: timestamp };
        await db.insert(brightdataProductInventory).values(values).onDuplicateKeyUpdate({ set: { productName: product.productName, availableQuantity: product.availableQuantity, queriedAt: timestamp, price: valueOrNull(product.price), description: product.description, rating: valueOrNull(product.rating), reviewCount: product.reviewCount, rawPayload: product.rawPayload } });
        success += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${itemId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    for (let index = 0; index < items.length; index += concurrency) {
      if (index > 0) await pause(intervalMs);
      await Promise.all(items.slice(index, index + concurrency).map(processItem));
    }
    const endedAt = now();
    const result = { total: items.length, success, failed };
    await db.update(brightdataRunHistory).set({ endedAt, totalItems: result.total, successCount: success, failCount: failed, status: failed ? 'completed_with_errors' : 'completed', errorMessage: errors.length ? errors.join('; ').slice(0, 65535) : null }).where(and(eq(brightdataRunHistory.runId, runId), eq(brightdataRunHistory.tenantId, tenantId)));
    return result;
  } finally {
    if (owned) await context.pool?.end();
  }
}
