import crypto from 'node:crypto';

/**
 * Migrate the three tables used by the original Bright Data collector.
 *
 * The source schema changed a few times, so the mapper accepts the common
 * snake_case/camelCase aliases. Unknown legacy columns are retained in
 * raw_payload to make the migration lossless.
 */

type LegacyRow = Record<string, any>;
type QueryPool = { query: (sql: string, values?: unknown[]) => Promise<[unknown, unknown]>; getConnection: () => Promise<QueryConnection>; end: () => Promise<void> };
type QueryConnection = { beginTransaction: () => Promise<void>; query: (sql: string, values?: unknown[]) => Promise<[unknown, unknown]>; commit: () => Promise<void>; rollback: () => Promise<void>; release: () => void };
export type MigrationMode = 'dry-run' | 'apply';

export interface MigrationOptions {
  sourceUrl: string;
  destinationUrl: string;
  tenantId: string;
  mode?: MigrationMode;
  sourceItemNamesTable?: string;
  sourceProductInventoryTable?: string;
  sourceRunHistoryTable?: string;
}

export interface MigrationCounts {
  itemNames: number;
  productInventory: number;
  runHistory: number;
}

export interface MigrationReport {
  mode: MigrationMode;
  source: MigrationCounts;
  destinationBefore: MigrationCounts;
  destinationAfter: MigrationCounts;
  itemIdCount: number;
  failedInventoryCount: number;
  duplicateInventorySnapshotCount: number;
  inventoryTimeRange: { min: string | null; max: string | null };
  inserted: MigrationCounts;
  updated: MigrationCounts;
}

const normalizedKey = (key: string): string => key.toLocaleLowerCase().replace(/[\s_-]/g, '');

const value = (row: LegacyRow, ...keys: string[]): unknown => {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  const normalized = new Map(Object.keys(row).map((key) => [normalizedKey(key), key]));
  for (const key of keys) {
    const actual = normalized.get(normalizedKey(key));
    if (actual !== undefined) return row[actual];
  }
  return null;
};

const text = (v: unknown): string | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return String(v).trim();
};

const integer = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || !Number.isSafeInteger(n)) throw new Error(`Invalid integer: ${String(v)}`);
  return n;
};

const decimal = (v: unknown): string | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid decimal: ${String(v)}`);
  return String(v);
};

export function parseDate(valueToParse: unknown, field: string): Date | null {
  if (valueToParse === null || valueToParse === undefined || String(valueToParse).trim() === '') return null;
  const date = valueToParse instanceof Date ? new Date(valueToParse.getTime()) : new Date(String(valueToParse));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}: ${String(valueToParse)}`);
  return date;
}

/** Old WBKC Time values are local China wall-clock strings without a zone. */
export function parseLegacyShanghaiDate(valueToParse: unknown, field: string): Date {
  if (valueToParse instanceof Date) {
    if (Number.isNaN(valueToParse.getTime())) throw new Error(`Invalid ${field}: ${String(valueToParse)}`);
    return new Date(valueToParse.getTime());
  }
  const raw = text(valueToParse);
  if (!raw) throw new Error(`Invalid ${field}: ${String(valueToParse)}`);
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const zoned = new Date(raw);
    if (Number.isNaN(zoned.getTime())) throw new Error(`Invalid ${field}: ${raw}`);
    return zoned;
  }
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(raw);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    const parts = [year, month, day, hour, minute, second].map(Number);
    const [y, m, d, h, min, sec] = parts;
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}+08:00`);
    if (Number.isNaN(date.getTime()) || m < 1 || m > 12 || d < 1 || h > 23 || min > 59 || sec > 59) throw new Error(`Invalid ${field}: ${raw}`);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new Error(`Invalid ${field}: ${raw}`);
    return date;
  }
  const fallback = new Date(`${raw.replace(' ', 'T')}+08:00`);
  if (Number.isNaN(fallback.getTime())) throw new Error(`Invalid ${field}: ${raw}`);
  return fallback;
}

/** UUID-shaped, deterministic ID for rows that have no usable primary key. */
export function deterministicId(namespace: string, sourceKey: unknown): string {
  const hex = crypto.createHash('sha256').update(`${namespace}:${String(sourceKey ?? '')}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20)}`;
}

function sourceKey(row: LegacyRow, fallback: number): string {
  return text(value(row, 'id', 'ID', 'row_id', 'source_row_id', 'sourceRowId')) ?? String(fallback);
}

function itemIdOf(row: LegacyRow): string | null {
  return text(value(row, 'item_id', 'itemId', 'Item ID', 'Item id', 'walmart_item_id', 'item', 'sku'));
}

export interface ItemNameRecord {
  id: string; tenantId: string; storeId: string | null; itemId: string; productName: string | null;
  sourceRowId: string | null; rawPayload: LegacyRow; createdAt: Date; updatedAt: Date;
}

export interface ProductInventoryRecord {
  id: string; tenantId: string; storeId: string | null; sourceItemId: string | null;
  itemId: string; runId: string; productName: string | null; availableQuantity: number | null;
  queriedAt: Date; price: string | null; description: string | null; rating: string | null;
  reviewCount: number | null; rawPayload: LegacyRow; idempotencyKey: string; createdAt: Date;
}

export interface RunHistoryRecord {
  runId: string; tenantId: string; startedAt: Date; endedAt: Date | null; totalItems: number;
  successCount: number; failCount: number; status: string; errorMessage: string | null;
}

export function mapItemNameRow(row: LegacyRow, tenantId: string, index = 0): ItemNameRecord {
  const key = sourceKey(row, index);
  const now = new Date();
  const itemId = itemIdOf(row);
  if (!itemId) throw new Error(`item_names row ${key} has no item_id`);
  const createdAt = parseDate(value(row, 'created_at', 'createdAt', 'created', 'date'), 'item_names.created_at') ?? now;
  const updatedAt = parseDate(value(row, 'updated_at', 'updatedAt', 'modified_at', 'modified'), 'item_names.updated_at') ?? createdAt;
  return { id: deterministicId('brightdata-item-name', key), tenantId: text(value(row, 'tenant_id', 'tenantId')) ?? tenantId, storeId: text(value(row, 'store_id', 'storeId')), itemId, productName: text(value(row, 'product_name', 'productName', 'Name', 'item_name', 'name')), sourceRowId: key, rawPayload: row, createdAt, updatedAt };
}

/** Preserve each legacy product while choosing its newest label for the unique tenant+Item ID row. */
export function selectCanonicalItemNameRows(rows: LegacyRow[]): LegacyRow[] {
  const selected = new Map<string, { row: LegacyRow; timestamp: number; sourceKey: string }>();
  rows.forEach((row, index) => {
    const itemId = itemIdOf(row);
    if (!itemId) throw new Error(`item_names row ${index} has no item_id`);
    const candidate = {
      row,
      timestamp: parseDate(value(row, 'created_at', 'createdAt', 'created'), 'item_names.created_at')?.getTime() ?? Number.NEGATIVE_INFINITY,
      sourceKey: sourceKey(row, index),
    };
    const current = selected.get(itemId);
    if (!current || candidate.timestamp > current.timestamp || (candidate.timestamp === current.timestamp && candidate.sourceKey.localeCompare(current.sourceKey) > 0)) selected.set(itemId, candidate);
  });
  return [...selected.values()].map(({ row }) => row);
}

export function mapProductInventoryRow(row: LegacyRow, tenantId: string, itemIds = new Map<string, string>(), index = 0): ProductInventoryRecord {
  const key = sourceKey(row, index);
  const itemId = itemIdOf(row);
  if (!itemId) throw new Error(`product_inventory row ${key} has no item_id`);
  const queriedAtValue = value(row, 'queried_at', 'queriedAt', 'query_time', 'queried_date', 'Time', 'created_at', 'createdAt');
  if (queriedAtValue === null || queriedAtValue === undefined || String(queriedAtValue).trim() === '') throw new Error(`product_inventory row ${key} has no queried_at`);
  const queriedAt = parseLegacyShanghaiDate(queriedAtValue, 'product_inventory.queried_at');
  const legacyRunId = text(value(row, 'run_id', 'runId', 'execution_id'));
  const runId = legacyRunId && legacyRunId.length <= 36 ? legacyRunId : deterministicId('brightdata-run', legacyRunId ?? `inventory:${key}`);
  const idempotencyKey = `legacy:product_inventory:${key}`;
  const productName = text(value(row, 'product_name', 'productName', 'PRODUCT NAME', 'name'));
  const isFailedScrape = productName?.includes('抓取失败') ?? false;
  return {
    id: deterministicId('brightdata-product-inventory', key), tenantId: text(value(row, 'tenant_id', 'tenantId')) ?? tenantId,
    storeId: text(value(row, 'store_id', 'storeId')), sourceItemId: itemIds.get(itemId) ?? null, itemId, runId,
    productName, availableQuantity: isFailedScrape ? null : integer(value(row, 'available_quantity', 'availableQuantity', 'quantity', 'inventory')),
    queriedAt, price: decimal(value(row, 'price')), description: text(value(row, 'description')), rating: decimal(value(row, 'rating')),
    reviewCount: integer(value(row, 'review_count', 'reviewCount', 'reviews')), rawPayload: row, idempotencyKey, createdAt: new Date(),
  };
}

export function mapRunHistoryRow(row: LegacyRow, tenantId: string, index = 0): RunHistoryRecord {
  const key = sourceKey(row, index);
  const rawRunId = text(value(row, 'run_id', 'runId', 'id')) ?? key;
  const runId = rawRunId.length <= 36 ? rawRunId : deterministicId('brightdata-run', rawRunId);
  const startedAt = parseDate(value(row, 'started_at', 'startedAt', 'start_time', 'created_at'), 'run_history.started_at');
  if (!startedAt) throw new Error(`run_history row ${key} has no started_at`);
  return {
    runId, tenantId: text(value(row, 'tenant_id', 'tenantId')) ?? tenantId, startedAt,
    endedAt: parseDate(value(row, 'ended_at', 'endedAt', 'end_time'), 'run_history.ended_at'),
    totalItems: integer(value(row, 'total_items', 'totalItems', 'total')) ?? 0,
    successCount: integer(value(row, 'success_count', 'successCount', 'success')) ?? 0,
    failCount: integer(value(row, 'fail_count', 'failCount', 'failed', 'failures')) ?? 0,
    status: text(value(row, 'status')) ?? 'completed', errorMessage: text(value(row, 'error_message', 'errorMessage', 'error')),
  };
}

export function validateSourceRows(rows: { itemNames: LegacyRow[]; productInventory: LegacyRow[]; runHistory: LegacyRow[] }): { itemIdCount: number; inventoryTimeRange: { min: string | null; max: string | null } } {
  const itemIds = new Set<string>();
  for (const [index, row] of rows.itemNames.entries()) {
    const itemId = itemIdOf(row);
    if (!itemId) throw new Error(`item_names row ${index} has no item_id`);
    itemIds.add(itemId);
  }
  const dates = rows.productInventory.map((row, index) => mapProductInventoryRow(row, 'validation', new Map(), index).queriedAt.getTime());
  const min = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
  const max = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  return { itemIdCount: itemIds.size, inventoryTimeRange: { min, max } };
}

type DestinationTable = 'brightdata_item_names' | 'brightdata_product_inventory' | 'brightdata_run_history';
function quotedIdentifier(table: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error(`Invalid table name: ${table}`);
  return `\`${table}\``;
}
async function rows(pool: QueryPool, table: string): Promise<LegacyRow[]> {
  const [result] = await pool.query(`SELECT * FROM ${quotedIdentifier(table)}`);
  return result as LegacyRow[];
}
async function count(pool: QueryPool, table: DestinationTable, tenantId: string): Promise<number> {
  const [result] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE tenant_id = ?`, [tenantId]) as [Array<{ total: number }>, unknown];
  return Number(result[0]?.total ?? 0);
}

async function sourceTableExists(pool: QueryPool, table: string): Promise<boolean> {
  const [result] = await pool.query('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]) as [Array<{ total: number }>, unknown];
  return Number(result[0]?.total ?? 0) > 0;
}

function duplicateSnapshotCount(rows: LegacyRow[]): number {
  const keys = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const itemId = itemIdOf(row);
    if (!itemId) throw new Error(`product_inventory row ${index} has no item_id`);
    const queriedAt = parseLegacyShanghaiDate(value(row, 'queried_at', 'queriedAt', 'query_time', 'queried_date', 'Time', 'created_at', 'createdAt'), 'product_inventory.queried_at');
    keys.add(`${itemId}\u0000${queriedAt.toISOString()}`);
  }
  return rows.length - keys.size;
}

async function upsertBatch(connection: QueryConnection, table: DestinationTable, columns: string[], records: unknown[][], updateColumns: string[]): Promise<number> {
  let affected = 0;
  for (let start = 0; start < records.length; start += 300) {
    const batch = records.slice(start, start + 300);
    const placeholders = batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const updates = updateColumns.map((column) => `\`${column}\`=VALUES(\`${column}\`)`).join(',');
    const [result] = await connection.query(`INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(',')}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`, batch.flat()) as [{ affectedRows: number }, unknown];
    affected += result.affectedRows;
  }
  return affected;
}

export async function migrateBrightDataLegacy(options: MigrationOptions): Promise<MigrationReport> {
  if (!options.tenantId.trim()) throw new Error('tenantId is required');
  const mode = options.mode ?? 'dry-run';
  const itemNamesTable = options.sourceItemNamesTable ?? 'WBKC_item_names';
  const inventoryTable = options.sourceProductInventoryTable ?? 'WBKC_product_inventory';
  const runHistoryTable = options.sourceRunHistoryTable;
  quotedIdentifier(itemNamesTable);
  quotedIdentifier(inventoryTable);
  if (runHistoryTable) quotedIdentifier(runHistoryTable);
  // Keep mysql2 lazy so pure mapping tests do not require a DB connection.
  const { createRequire } = await import('node:module');
  const requireFromDb = createRequire(`${process.cwd()}/packages/db/package.json`);
  const mysql = requireFromDb('mysql2/promise') as { createPool: (config: Record<string, unknown>) => unknown };
  const source = mysql.createPool({ uri: options.sourceUrl, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 2 }) as unknown as QueryPool;
  const destination = mysql.createPool({ uri: options.destinationUrl, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 2 }) as unknown as QueryPool;
  try {
    const [itemRows, inventoryRows, hasRunHistory] = await Promise.all([
      rows(source, itemNamesTable), rows(source, inventoryTable), runHistoryTable ? sourceTableExists(source, runHistoryTable) : Promise.resolve(false),
    ]) as [LegacyRow[], LegacyRow[], boolean];
    if (runHistoryTable && !hasRunHistory) throw new Error(`Source run history table not found: ${runHistoryTable}`);
    const historyRows = hasRunHistory && runHistoryTable ? await rows(source, runHistoryTable) : [];
    const validation = validateSourceRows({ itemNames: itemRows, productInventory: inventoryRows, runHistory: historyRows });
    const sourceCounts = { itemNames: itemRows.length, productInventory: inventoryRows.length, runHistory: historyRows.length };
    const destinationBefore = { itemNames: await count(destination, 'brightdata_item_names', options.tenantId), productInventory: await count(destination, 'brightdata_product_inventory', options.tenantId), runHistory: await count(destination, 'brightdata_run_history', options.tenantId) };
    const failedInventoryCount = inventoryRows.filter((row) => text(value(row, 'product_name', 'productName', 'PRODUCT NAME', 'name'))?.includes('抓取失败')).length;
    const duplicateInventorySnapshotCount = duplicateSnapshotCount(inventoryRows);
    const inserted = { itemNames: 0, productInventory: 0, runHistory: 0 };
    const updated = { itemNames: 0, productInventory: 0, runHistory: 0 };
    const plannedWrites = { itemNames: 0, productInventory: 0, runHistory: historyRows.length };
    if (mode === 'apply') {
      const canonicalItemRows = selectCanonicalItemNameRows(itemRows);
      const itemRecords = canonicalItemRows.map((row, i) => mapItemNameRow(row, options.tenantId, i));
      plannedWrites.itemNames = itemRecords.length;
      const itemIds = new Map(itemRecords.map((record) => [record.itemId, record.id]));
      const inventoryRecords = inventoryRows.map((row, i) => mapProductInventoryRow(row, options.tenantId, itemIds, i));
      plannedWrites.productInventory = inventoryRecords.length;
      const historyRecords = historyRows.map((row, i) => mapRunHistoryRow(row, options.tenantId, i));
      const conn = await destination.getConnection();
      try {
        await conn.beginTransaction();
        await upsertBatch(conn, 'brightdata_item_names', ['id', 'tenant_id', 'store_id', 'item_id', 'product_name', 'source_row_id', 'raw_payload', 'created_at', 'updated_at'], itemRecords.map((r) => [r.id, r.tenantId, r.storeId, r.itemId, r.productName, r.sourceRowId, JSON.stringify(r.rawPayload), r.createdAt, r.updatedAt]), ['store_id', 'product_name', 'source_row_id', 'raw_payload', 'updated_at']);
        await upsertBatch(conn, 'brightdata_product_inventory', ['id', 'tenant_id', 'store_id', 'source_item_id', 'item_id', 'run_id', 'product_name', 'available_quantity', 'queried_at', 'price', 'description', 'rating', 'review_count', 'raw_payload', 'idempotency_key', 'created_at'], inventoryRecords.map((r) => [r.id, r.tenantId, r.storeId, r.sourceItemId, r.itemId, r.runId, r.productName, r.availableQuantity, r.queriedAt, r.price, r.description, r.rating, r.reviewCount, JSON.stringify(r.rawPayload), r.idempotencyKey, r.createdAt]), ['store_id', 'source_item_id', 'run_id', 'product_name', 'available_quantity', 'queried_at', 'price', 'description', 'rating', 'review_count', 'raw_payload']);
        if (historyRecords.length) {
          await upsertBatch(conn, 'brightdata_run_history', ['run_id', 'tenant_id', 'started_at', 'ended_at', 'total_items', 'success_count', 'fail_count', 'status', 'error_message'], historyRecords.map((r) => [r.runId, r.tenantId, r.startedAt, r.endedAt, r.totalItems, r.successCount, r.failCount, r.status, r.errorMessage]), ['tenant_id', 'started_at', 'ended_at', 'total_items', 'success_count', 'fail_count', 'status', 'error_message']);
        }
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    }
    const destinationAfter = mode === 'apply' ? { itemNames: await count(destination, 'brightdata_item_names', options.tenantId), productInventory: await count(destination, 'brightdata_product_inventory', options.tenantId), runHistory: await count(destination, 'brightdata_run_history', options.tenantId) } : destinationBefore;
    if (mode === 'apply') {
      for (const key of Object.keys(plannedWrites) as (keyof MigrationCounts)[]) {
        inserted[key] = Math.max(0, Math.min(plannedWrites[key], destinationAfter[key] - destinationBefore[key]));
        updated[key] = plannedWrites[key] - inserted[key];
      }
    }
    return { mode, source: sourceCounts, destinationBefore, destinationAfter, itemIdCount: validation.itemIdCount, failedInventoryCount, duplicateInventorySnapshotCount, inventoryTimeRange: validation.inventoryTimeRange, inserted, updated };
  } finally { await source.end(); await destination.end(); }
}

function cli(argv: string[]): MigrationOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) if (argv[i]?.startsWith('--')) { const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) args.set(key, next), i++; else args.set(key, 'true'); }
  const sourceUrl = args.get('source-url') ?? process.env.LEGACY_MYSQL_URL ?? process.env.MYSQL_URL;
  const destinationUrl = args.get('destination-url') ?? process.env.MYSQL_URL;
  const tenantId = args.get('tenant-id') ?? process.env.BRIGHTDATA_TENANT_ID ?? 'default';
  if (!sourceUrl || !destinationUrl) throw new Error('Usage: migrate-brightdata-legacy.ts --source-url URL --destination-url URL [--tenant-id ID] [--source-item-names TABLE] [--source-product-inventory TABLE] [--source-run-history TABLE] [--apply|--dry-run]');
  return { sourceUrl, destinationUrl, tenantId, sourceItemNamesTable: args.get('source-item-names'), sourceProductInventoryTable: args.get('source-product-inventory'), sourceRunHistoryTable: args.get('source-run-history'), mode: args.has('apply') ? 'apply' : 'dry-run' };
}

if (process.argv.some((argument) => argument.endsWith('migrate-brightdata-legacy.ts'))) {
  void (async () => {
    try { console.log(JSON.stringify(await migrateBrightDataLegacy(cli(process.argv.slice(2))), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  })();
}
