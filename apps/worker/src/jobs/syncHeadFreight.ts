import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { and, createDb, eq, headFreightRows, inArray, rawPayloads, smartSheetAllSkuRows, stores, wecomBotConfigs } from '../../../../packages/db/index.js';
import type { AppDatabase } from '../../../../packages/db/src/db.js';

export interface SmartSheetRecord { id?: string; values?: Record<string, unknown>; [key: string]: unknown }
function smartCellText(value: unknown): string | null {
  if (Array.isArray(value)) return smartCellText(value[0]);
  if (value && typeof value === 'object') return smartCellText((value as Record<string, unknown>).text ?? (value as Record<string, unknown>).value ?? (value as Record<string, unknown>).userName);
  const text = value == null ? '' : String(value).trim();
  return text || null;
}
function smartStandardFields(record: SmartSheetRecord) {
  const values = record.values ?? {};
  const get = (...names: string[]) => { for (const name of names) { const value = smartCellText(values[name]); if (value) return value; } return null; };
  return { sku: get('SKU','sku'), itemId: get('Item ID','Item Id','item_id'), productName: get('品名','产品名称','Product Name'), storeName: get('店铺','店铺名称','Store'), ownerName: get('当前负责人','负责人','Owner') };
}
export interface WecomPageConfig { documentUrl: string; tableId: string; apiKey?: string; botId?: string; secret?: string }
export interface WecomMcpConfig extends WecomPageConfig { call?: (tool: string, args: Record<string, unknown>) => Promise<any>; endpoint?: string }
export interface NormalizedHeadFreightRow {
  sourceRowId: string; sourceStoreName?: string; contractNumber?: string; purchaseBatchNumber?: string; sku?: string; productName?: string;
  quantity?: string; cartonCount?: string; wfsShipmentNumber?: string; freightForwarderInboundNumber?: string; trackingNumber?: string;
  shippedAt?: string; etd?: string; eta?: string; currentStatus?: string; signedStatus?: string; billableWeight?: string; totalFreight?: string;
  logisticsProvider?: string; warehouse?: string; paymentStatus?: string; shippingStatus?: string; shippingMethod?: string; channel?: string;
  payload: unknown; hasContent: boolean; batchId: string;
}
export interface HeadFreightStore { id: string; name: string }

const fieldMap: Record<string, keyof Omit<NormalizedHeadFreightRow, 'sourceRowId' | 'payload' | 'hasContent' | 'batchId'>> = {
  合同编号: 'contractNumber', 采购批次号: 'purchaseBatchNumber', SKU: 'sku', 产品名称: 'productName', 数量: 'quantity', 件数: 'cartonCount', 店铺名称: 'sourceStoreName',
  WFS货件号: 'wfsShipmentNumber', 货代入库号: 'freightForwarderInboundNumber', 运单号: 'trackingNumber', 发货时间: 'shippedAt', ETD: 'etd', ETA: 'eta', 当前状态: 'currentStatus', 签收状态: 'signedStatus',
  计费重: 'billableWeight', 总运费: 'totalFreight', 物流商: 'logisticsProvider', 仓库: 'warehouse', 付款状态: 'paymentStatus', 发货状态: 'shippingStatus', 发货方式: 'shippingMethod', 渠道: 'channel',
};
const dateFields = new Set(['shippedAt', 'etd', 'eta']);
const integerFields = new Set(['quantity', 'cartonCount']);

function cellText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) { const parts = value.map(cellText).filter((item): item is string => Boolean(item?.trim())); return parts.length ? parts.join(' ') : undefined; }
  if (typeof value === 'object') { const object = value as Record<string, unknown>; return cellText(object.text ?? object.userName ?? object.value); }
  const text = String(value).trim(); return text && text !== '\\n' ? text : undefined;
}
function dateValue(value: string | undefined): string | undefined { const match = value?.match(/(\d{4}-\d{2}-\d{2})/); return match?.[1]; }
function normalizedValue(key: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (dateFields.has(key)) return dateValue(value);
  if (integerFields.has(key)) { const digits = value.replace(/[^\d]/g, ''); return digits || undefined; }
  if (key === 'totalFreight') { const amount = value.replace(/[^\d.\-]/g, ''); return amount || undefined; }
  if (key === 'contractNumber') return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n').toUpperCase() || undefined;
  if (key === 'currentStatus') return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' ') || undefined;
  return value;
}

export function normalizeHeadFreightRecord(record: SmartSheetRecord, context: { tenantId: string; batchId: string }): NormalizedHeadFreightRow {
  const values = record.values ?? {};
  const row: Record<string, unknown> = {};
  for (const [source, target] of Object.entries(fieldMap)) row[target] = normalizedValue(target, cellText(values[source]));
  // A head-freight row must contain at least one freight-specific field.  SKU
  // alone is also present in ALLSKU2026, so accepting any mapped value would
  // silently ingest the product master table when the configured sheet ID is
  // wrong.  Keep SKU as useful data, but never use it as source validation.
  const freightSourceFields = ['contractNumber', 'purchaseBatchNumber', 'sourceStoreName', 'wfsShipmentNumber', 'freightForwarderInboundNumber', 'trackingNumber', 'shippedAt', 'etd', 'eta', 'currentStatus', 'signedStatus', 'billableWeight', 'totalFreight', 'logisticsProvider', 'warehouse', 'paymentStatus', 'shippingStatus', 'shippingMethod', 'channel'];
  const hasContent = freightSourceFields.some((field) => {
    const value = row[field];
    return value !== undefined && value !== '';
  });
  return { sourceRowId: String(record.id ?? createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)), ...row as Omit<NormalizedHeadFreightRow, 'sourceRowId' | 'payload' | 'hasContent' | 'batchId'>, payload: record, hasContent, batchId: context.batchId };
}

function normalizeKey(value: string | undefined): string | undefined { const key = value?.replace(/\s+/g, '').trim().toUpperCase(); return key || undefined; }
export function matchHeadFreightStore(row: NormalizedHeadFreightRow, availableStores: HeadFreightStore[]): { storeId?: string; status: 'matched' | 'unmatched'; sourceStoreName?: string } {
  const sourceStoreName = row.sourceStoreName?.trim() || undefined;
  const key = normalizeKey(sourceStoreName);
  const found = key ? availableStores.find((store) => normalizeKey(store.name) === key) : undefined;
  return { storeId: found?.id, status: found ? 'matched' : 'unmatched', sourceStoreName };
}
export function mergeNonEmptyHeadFreightFields<T extends Record<string, unknown>>(existing: T, incoming: Partial<T>): T {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) if (value !== undefined && value !== null && value !== '') merged[key as keyof T] = value as T[keyof T];
  return merged;
}

function createDefaultCall(config: WecomMcpConfig): (tool: string, args: Record<string, unknown>) => Promise<any> {
  if (!config.endpoint) throw new Error('WECom MCP endpoint is not configured');
  let sessionId: string | undefined;
  let initialized = false;
  let rpcId = 0;
  const endpoint = new URL(config.endpoint);
  if (config.apiKey) endpoint.searchParams.set('apikey', config.apiKey);
  if (config.botId) endpoint.searchParams.set('bot_id', config.botId);
  if (config.secret) endpoint.searchParams.set('secret', config.secret);
  const rpc = async (method: string, params: Record<string, unknown>, notification = false): Promise<any> => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}), ...(config.botId ? { 'X-Bot-ID': config.botId } : {}), ...(config.secret ? { 'X-Bot-Secret': config.secret } : {}) }, body: JSON.stringify(notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params }) });
    const nextSession = response.headers.get('Mcp-Session-Id'); if (nextSession) sessionId = nextSession;
    if (notification) return undefined;
    if (!response.ok) throw new Error(`WECom MCP request failed: ${response.status}`);
    const text = await response.text();
    const dataLine = text.split(/\r?\n/).find((line) => line.trim().startsWith('data:'))?.replace(/^\s*data:\s*/, '').trim();
    const body = JSON.parse(dataLine && dataLine !== '[DONE]' ? dataLine : text) as { result?: { content?: Array<{ type?: string; text?: string }> }; error?: unknown };
    if (body.error) throw new Error(`WECom MCP error: ${JSON.stringify(body.error)}`);
    return body;
  };
  return async (tool, args) => {
    if (!initialized) { await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'walmart-erp-head-freight', version: '1.0' } }); await rpc('notifications/initialized', {}, true); initialized = true; }
    const response = await rpc('tools/call', { name: tool, arguments: args });
    const text = response.result?.content?.find((item: { type?: string }) => item.type === 'text')?.text;
    if (!text) return response;
    try { return JSON.parse(text); } catch { return { raw: text }; }
  };
}

export async function listSmartSheetRecords(config: WecomMcpConfig): Promise<SmartSheetRecord[]> {
  const records: SmartSheetRecord[] = [];
  const call = config.call ?? createDefaultCall(config);
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (;;) {
    const args: Record<string, unknown> = { docid: config.documentUrl, sheet_id: config.tableId, type: 'records', key_type: 'field_title', limit: 500 };
    if (cursor) args.cursor = cursor;
    const data = await call('smartsheet_records_list', args) as { errcode?: number; errmsg?: string; records?: SmartSheetRecord[]; has_more?: boolean; next_cursor?: string };
    if (data.errcode && data.errcode !== 0) throw new Error(`WeCom SmartSheet request failed (${data.errcode}): ${data.errmsg ?? 'authorization or document access failed'}`);
    records.push(...(data.records ?? []));
    if (!data.has_more) return records;
    if (!data.next_cursor || seen.has(data.next_cursor)) throw new Error('WECom MCP pagination cursor repeated or missing');
    seen.add(data.next_cursor); cursor = data.next_cursor;
  }
}

export async function syncSmartSheetRecordsToRawPayloads(input: { tenantId: string; documentUrl: string; tableId: string; resource: string; batchId: string }, config: Omit<WecomMcpConfig, 'documentUrl' | 'tableId'>): Promise<{ resource: string; received: number; written: number; skipped: number; batchId: string }> {
  const records = await listSmartSheetRecords({ ...config, documentUrl: input.documentUrl, tableId: input.tableId });
  const { db, pool } = createDb();
  try {
    let written = 0;
    let skipped = 0;
    const currentSourceIds: string[] = [];
    for (const record of records) {
      const externalId = String(record.id ?? record.record_id ?? record.recordId ?? '');
      if (!externalId) { skipped += 1; continue; }
      currentSourceIds.push(externalId);
      const now = new Date();
      const id = createHash('sha256').update(`${input.tenantId}:smartsheet-allsku2026:${externalId}`).digest('hex');
      const [businessRow] = await db.select({ id: smartSheetAllSkuRows.id, createdAt: smartSheetAllSkuRows.createdAt }).from(smartSheetAllSkuRows).where(and(eq(smartSheetAllSkuRows.tenantId, input.tenantId), eq(smartSheetAllSkuRows.sourceRowId, externalId))).limit(1);
      const standard = smartStandardFields(record);
      if (businessRow) {
        await db.update(smartSheetAllSkuRows).set({ ...standard, payload: record, batchId: input.batchId, syncedAt: now, updatedAt: now }).where(eq(smartSheetAllSkuRows.id, businessRow.id));
      } else {
        await db.insert(smartSheetAllSkuRows).values({ id, tenantId: input.tenantId, sourceRowId: externalId, ...standard, payload: record, batchId: input.batchId, syncedAt: now, createdAt: now, updatedAt: now });
      }
      const [existing] = await db.select({ id: rawPayloads.id }).from(rawPayloads).where(and(eq(rawPayloads.tenantId, input.tenantId), eq(rawPayloads.resource, input.resource), eq(rawPayloads.externalId, externalId))).limit(1);
      if (existing) {
        await db.update(rawPayloads).set({ storeId: null, payload: record, httpStatus: 200, correlationId: input.batchId, receivedAt: new Date() }).where(eq(rawPayloads.id, existing.id));
      } else {
        await db.insert(rawPayloads).values({ tenantId: input.tenantId, storeId: null, resource: input.resource, externalId, payload: record, httpStatus: 200, correlationId: input.batchId, receivedAt: new Date() });
      }
      written += 1;
    }
    if (skipped === 0) {
      const currentIds = new Set(currentSourceIds);
      const existingRows = await db.select({ sourceRowId: smartSheetAllSkuRows.sourceRowId }).from(smartSheetAllSkuRows).where(eq(smartSheetAllSkuRows.tenantId, input.tenantId));
      const staleIds = existingRows.map((row) => row.sourceRowId).filter((sourceRowId) => !currentIds.has(sourceRowId));
      if (staleIds.length) await db.delete(smartSheetAllSkuRows).where(and(eq(smartSheetAllSkuRows.tenantId, input.tenantId), inArray(smartSheetAllSkuRows.sourceRowId, staleIds)));
    }
    return { resource: input.resource, received: records.length, written, skipped, batchId: input.batchId };
  } finally { await pool.end(); }
}

export interface HeadFreightSyncWindow { tenantId: string; from: string; to: string; batchId: string }
export interface HeadFreightSyncResult { resource: 'head-freight'; received: number; written: number; skipped: number; unmatchedStoreNames: string[]; rawPayloadIds: string[] }

function encryptionKey(): Buffer { const value = process.env.CREDENTIAL_ENCRYPTION_KEY; if (!value) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be configured'); const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'utf8'); if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes or 64 hexadecimal characters'); return key; }
function decryptBotCredential(value: string): string { const [iv, tag, ciphertext] = value.split('.'); if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted WeCom Bot credential'); const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url')); decipher.setAuthTag(Buffer.from(tag, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'); }
export async function loadWecomHeadFreightConfig(tenantId: string): Promise<WecomMcpConfig> { const { db, pool } = createDb(); try { const [row] = await db.select().from(wecomBotConfigs).where(eq(wecomBotConfigs.tenantId, tenantId)).limit(1); if (!row?.encryptedBotKey) throw new Error('WeCom MCP API Key is not configured'); return { documentUrl: row.documentUrl, tableId: row.tableId, apiKey: decryptBotCredential(row.encryptedBotKey), botId: row.encryptedBotId ? decryptBotCredential(row.encryptedBotId) : undefined, secret: row.encryptedBotSecret ? decryptBotCredential(row.encryptedBotSecret) : undefined, endpoint: process.env.WECOM_MCP_ENDPOINT ?? 'https://qyapi.weixin.qq.com/mcp/v2/bot/doc' }; } finally { await pool.end(); } }

function rowId(tenantId: string, sourceRowId: string): string { return createHash('sha256').update(`${tenantId}:head-freight:${sourceRowId}`).digest('hex').slice(0, 64); }
function rowValues(row: NormalizedHeadFreightRow, storeId: string | undefined, matchStatus: 'matched' | 'unmatched', rawPayloadId: string, window: HeadFreightSyncWindow) {
  const now = new Date();
  return { id: rowId(window.tenantId, row.sourceRowId), tenantId: window.tenantId, storeId: storeId ?? null, sourceStoreName: row.sourceStoreName ?? null, contractNumber: row.contractNumber ?? null, purchaseBatchNumber: row.purchaseBatchNumber ?? null, sku: row.sku ?? null, productName: row.productName ?? null, quantity: row.quantity ?? null, cartonCount: row.cartonCount ?? null, wfsShipmentNumber: row.wfsShipmentNumber ?? null, freightForwarderInboundNumber: row.freightForwarderInboundNumber ?? null, trackingNumber: row.trackingNumber ?? null, shippedAt: row.shippedAt ?? null, etd: row.etd ?? null, eta: row.eta ?? null, currentStatus: row.currentStatus ?? null, signedStatus: row.signedStatus ?? null, billableWeight: row.billableWeight ?? null, totalFreight: row.totalFreight ?? null, logisticsProvider: row.logisticsProvider ?? null, warehouse: row.warehouse ?? null, paymentStatus: row.paymentStatus ?? null, shippingStatus: row.shippingStatus ?? null, shippingMethod: row.shippingMethod ?? null, channel: row.channel ?? null, matchStatus, sourceRowId: row.sourceRowId, idempotencyKey: `${window.batchId}:${row.sourceRowId}`, batchId: window.batchId, rawPayloadId, payload: row.payload, receivedAt: now, updatedAt: now };
}

export async function syncHeadFreightToDatabase(window: HeadFreightSyncWindow, config: WecomMcpConfig, dbOverride?: AppDatabase): Promise<HeadFreightSyncResult> {
  const owned = !dbOverride;
  const context = dbOverride ? { db: dbOverride, pool: undefined } : createDb();
  const db = context.db;
  try {
    const availableStores = await db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.tenantId, window.tenantId));
    const records = await listSmartSheetRecords(config);
    const freightFieldNames = new Set(['合同编号', '采购批次号', '店铺名称', 'WFS货件号', '货代入库号', '运单号', '发货时间', 'ETD', 'ETA', '当前状态', '签收状态', '计费重', '总运费', '物流商', '仓库', '付款状态', '发货状态', '发货方式', '渠道']);
    const allSkuMarkers = new Set(['UPC', '品名', 'Item ID', '领星SKU', '产品状态', '当前负责人']);
    const hasFreightColumns = records.some((record) => Object.keys(record.values ?? {}).some((key) => freightFieldNames.has(key)));
    const looksLikeAllSku = records.length > 0 && records.every((record) => {
      const keys = new Set(Object.keys(record.values ?? {}));
      return [...keys].some((key) => allSkuMarkers.has(key)) && ![...keys].some((key) => freightFieldNames.has(key));
    });
    if (!hasFreightColumns && looksLikeAllSku) {
      throw new Error('Configured SmartSheet table is ALLSKU2026, not the head-freight table; update the head-freight table ID before syncing.');
    }
    const rawPayloadIds: string[] = [];
    const sourceId = randomUUID();
    await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: null, resource: 'head-freight', externalId: sourceId, payload: records, httpStatus: 200, correlationId: sourceId, receivedAt: new Date() });
    rawPayloadIds.push(sourceId);
    let written = 0; let skipped = 0; const unmatched = new Set<string>();
    for (const record of records) {
      const row = normalizeHeadFreightRecord(record, { tenantId: window.tenantId, batchId: window.batchId });
      if (!row.hasContent) { skipped += 1; continue; }
      const match = matchHeadFreightStore(row, availableStores); if (!match.storeId && match.sourceStoreName) unmatched.add(match.sourceStoreName);
      const values = rowValues(row, match.storeId, match.status, sourceId, window);
      const [existing] = await db.select().from(headFreightRows).where(and(eq(headFreightRows.tenantId, window.tenantId), eq(headFreightRows.sourceRowId, row.sourceRowId))).limit(1);
      if (existing) {
        const merged = mergeNonEmptyHeadFreightFields(existing, values);
        await db.update(headFreightRows).set({ ...merged, id: existing.id, updatedAt: new Date() }).where(eq(headFreightRows.id, existing.id));
      } else {
        try {
          await db.insert(headFreightRows).values(values);
        } catch (error) {
          const [concurrentExisting] = await db.select().from(headFreightRows).where(and(eq(headFreightRows.tenantId, window.tenantId), eq(headFreightRows.sourceRowId, row.sourceRowId))).limit(1);
          if (concurrentExisting) {
            const merged = mergeNonEmptyHeadFreightFields(concurrentExisting, values);
            await db.update(headFreightRows).set({ ...merged, id: concurrentExisting.id, updatedAt: new Date() }).where(eq(headFreightRows.id, concurrentExisting.id));
            written += 1;
            continue;
          }
          const detail = error instanceof Error && error.cause instanceof Error ? `${error.message}; cause: ${error.cause.message}` : error instanceof Error ? error.message : String(error);
          throw new Error(`Head freight row ${row.sourceRowId} failed: ${detail}`);
        }
      }
      written += 1;
    }
    if (records.length > 0 && written === 0 && skipped === records.length) {
      throw new Error('Configured SmartSheet table does not contain head-freight fields; it appears to be the ALLSKU/product table. Check the head-freight table ID.');
    }
    return { resource: 'head-freight', received: records.length, written, skipped, unmatchedStoreNames: [...unmatched].sort(), rawPayloadIds };
  } finally { if (owned && context.pool) await context.pool.end(); }
}
