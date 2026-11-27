import {reportWait,reportProgress} from '../../../../packages/walmart-client/src/reportContinuation.js';
import {persistItemReport} from '../../../../packages/db/src/normalization/item-report.js';
import {transaction} from '../../../../packages/db/src/normalization/common.js';
import { createHash, randomUUID } from 'node:crypto';
import { createDb, rawPayloads, skus, sql } from '../../../../packages/db/index.js';
import { downloadItemReport, getItemReportStatus, normalizeItemReportCsv, requestItemReport, type WalmartConnection } from '@walmart-erp/walmart-client';

type ItemReportWindow = { tenantId: string; storeId: string };
export type ItemReportRequest = { requestId: string; reportType?: string; status?: string; createdTime?: string; correlationId?: string };
type ReportStatusLoader = (requestId: string) => Promise<any>;
type Delay = (milliseconds: number) => Promise<void>;
const delay: Delay = (milliseconds) => reportWait(milliseconds);
const skuRecordId = (storeId: string, sku: string) => createHash('sha256').update(`${storeId}:${sku}`).digest('hex').slice(0, 36);

function reportStatus(payload: any): string {
  return String(payload?.reportRequest?.status ?? payload?.status ?? payload?.requestStatus ?? '').toUpperCase();
}

export async function waitForItemReport(requestId: string, loadStatus: ReportStatusLoader, sleep: Delay = delay, initial: any = { status: 'RECEIVED' }): Promise<{ status: string; response: any }> {
  let response = initial;
  let status = reportStatus(response);
  const terminalStatuses = ['READY', 'COMPLETED', 'SUCCESS'];
  const failedStatuses = ['ERROR', 'FAILED'];
  // Walmart can finish an asynchronously-created report before the worker's next tick.
  // Check once immediately so READY reports are downloaded without the old 10-minute delay.
  for (let attempt = 0; !terminalStatuses.includes(status) && attempt < 6; attempt++) {
    if (failedStatuses.includes(status)) throw new Error(`Walmart Item report failed: ${status}`);
    response = await loadStatus(requestId);
    status = reportStatus(response);
    if (terminalStatuses.includes(status)) break;
    if (failedStatuses.includes(status)) throw new Error(`Walmart Item report failed: ${status}`);
    await sleep(600_000);
  }
  if (!terminalStatuses.includes(status)) throw new Error(`Walmart Item report timed out: ${status || 'UNKNOWN'}`);
  return { status, response };
}

export async function persistItemReportToDatabase(window: ItemReportWindow, connection: WalmartConnection, requested: ItemReportRequest, statusResponse: any) {
  const { db, pool } = createDb();
  const receivedAt = new Date();
  try {
    const status = reportStatus(statusResponse);
    const report = await downloadItemReport(connection, requested.requestId);
    await reportProgress('正在标准化入库');
    const rows = normalizeItemReportCsv(report.content);
    const sourceId = `item-report:${requested.requestId}`;
    await transaction(async c=>{
      await c.query("INSERT INTO raw_payloads (tenant_id,store_id,resource,external_id,payload,http_status,correlation_id,received_at) VALUES (?,?,'item-report',?,?,200,?,?)",[window.tenantId,window.storeId,sourceId,JSON.stringify({request:requested,statusResponse,downloadMetadata:report.metadata,rowCount:rows.length,rows:rows.map(row=>row.fields)}),requested.correlationId||requested.requestId,receivedAt]);
      await persistItemReport(c,rows.map(row=>row.fields),{tenantId:window.tenantId,storeId:window.storeId,sourceId,requestId:requested.requestId,capturedAt:receivedAt});
    },pool);
    for (const row of rows) {
      const details = { itemReport: row.fields };
      await db.insert(skus).values({ id: skuRecordId(window.storeId, row.sku), tenantId: window.tenantId, storeId: window.storeId, externalId: row.sku, itemId: row.productId, title: row.productName, brand: row.brand, publishedStatus: row.publishStatus, imageUrl: row.primaryImageUrl, details, createdAt: receivedAt, updatedAt: receivedAt }).onDuplicateKeyUpdate({ set: {
        itemId: sql`COALESCE(VALUES(${skus.itemId}), ${skus.itemId})`,
        title: sql`COALESCE(VALUES(${skus.title}), ${skus.title})`,
        brand: sql`COALESCE(VALUES(${skus.brand}), ${skus.brand})`,
        publishedStatus: sql`COALESCE(VALUES(${skus.publishedStatus}), ${skus.publishedStatus})`,
        imageUrl: sql`COALESCE(VALUES(${skus.imageUrl}), ${skus.imageUrl})`,
        details: sql`JSON_MERGE_PATCH(COALESCE(${skus.details}, JSON_OBJECT()), VALUES(${skus.details}))`,
        updatedAt: receivedAt,
      } });
    }
    return { resource: 'item-report', requestId: requested.requestId, status, received: rows.length, normalized: rows.length, correlationIds: [requested.correlationId, requested.requestId].filter(Boolean) };
  } finally {
    await pool.end();
  }
}

export async function syncItemReportToDatabase(window: ItemReportWindow, connection: WalmartConnection) {
  const requested = await requestItemReport(connection);
  const { status, response: statusResponse } = await waitForItemReport(requested.requestId, (id) => getItemReportStatus(connection, id), delay, requested);
  return persistItemReportToDatabase(window, connection, requested, statusResponse ?? { status });
}
