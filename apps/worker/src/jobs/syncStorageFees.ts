import { createHash } from 'node:crypto';
import { and, createDb, eq, gte, lte, paymentReports, reconTransactions, sql, storageFees } from '../../../../packages/db/index.js';
import {
  getAvailableReconReportDates,
  getReconReportPage,
  normalizeReconStorageFees,
  normalizeReconTransactions,
  reconNextOffset,
  reconReportMonth,
  type WalmartConnection,
} from '@walmart-erp/walmart-client';

const RECON_PAGE_SIZE = 1000;

function reportDateTimestamp(value: string): number {
  const match = value.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
}

export function latestReconReportDate(dates: string[], to: string): string | undefined {
  const end = Date.parse(to);
  return [...dates]
    .filter((date) => reportDateTimestamp(date) <= (Number.isNaN(end) ? Number.POSITIVE_INFINITY : end))
    .sort((left, right) => reportDateTimestamp(right) - reportDateTimestamp(left))[0];
}

function monthRange(window: { from: string; to: string }): { from: string; to: string } {
  const fallback = new Date().toISOString().slice(0, 7);
  return { from: window.from.slice(0, 7) || fallback, to: window.to.slice(0, 7) || fallback };
}

function pageSourceId(reportDate: string, offset: number): string {
  return `recon-report:${reportDate}:${offset}`;
}

function reportSourceId(reportDate: string): string {
  return `recon-report:${reportDate}`;
}

function aggregateRows(rows: ReturnType<typeof normalizeReconStorageFees>) {
  const grouped = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.month}:${row.feeType}:${row.currency}`;
    const previous = grouped.get(key);
    grouped.set(key, previous ? { ...previous, amount: previous.amount + row.amount } : row);
  }
  return [...grouped.values()];
}

export interface ReconReportPage {
  offset: number;
  data: unknown;
  correlationId: string;
}

export async function collectReconReportPages(
  reportDate: string,
  fetchPage: (reportDate: string, offset: number, pageSize: number) => Promise<{ data: unknown; correlationId: string }>,
  pageSize = RECON_PAGE_SIZE,
): Promise<ReconReportPage[]> {
  const pages: ReconReportPage[] = [];
  let offset = 0;
  while (true) {
    const response = await fetchPage(reportDate, offset, pageSize);
    pages.push({ offset, data: response.data, correlationId: response.correlationId });
    const nextOffset = reconNextOffset(response.data, offset, pageSize);
    if (nextOffset === undefined || nextOffset <= offset) return pages;
    offset = nextOffset;
  }
}

export async function syncStorageFeesToDatabase(window: { tenantId: string; storeId: string; from: string; to: string }, connection: WalmartConnection) {
  const { db, pool } = createDb();
  const receivedAt = new Date();
  const range = monthRange(window);
  try {
    const availableDates = await getAvailableReconReportDates(connection);
    const reportDate = latestReconReportDate(availableDates, window.to);
    if (!reportDate) return { resource: 'storage-fees', received: 0, normalized: 0, correlationId: 'recon-report:none', correlationIds: [] };

    const normalizedReportSourceId = reportSourceId(reportDate);
    const pages = await collectReconReportPages(reportDate, (date, offset, pageSize) => getReconReportPage(connection, date, offset, pageSize));
    const transactions = pages.flatMap(({ offset, data }) => normalizeReconTransactions(data, {
        tenantId: window.tenantId,
        storeId: window.storeId,
        reportDate,
        sourceId: normalizedReportSourceId,
        receivedAt,
        rowOffset: offset,
      }));
    const storageRows = aggregateRows(pages.flatMap(({ data }) => normalizeReconStorageFees(data, window.storeId, reportDate).filter((row) => row.month >= range.from && row.month <= range.to)));
    const statementMonth = reconReportMonth(reportDate) ?? range.to;
    const correlationIds = pages.map((page) => page.correlationId);

    await db.transaction(async (tx) => {
      await tx.delete(reconTransactions).where(and(
        eq(reconTransactions.tenantId, window.tenantId),
        eq(reconTransactions.storeId, window.storeId),
        eq(reconTransactions.sourceId, normalizedReportSourceId),
      ));
      for (const page of pages) {
        const sourceId = pageSourceId(reportDate, page.offset);
        await tx.insert(paymentReports).values({
          id: createHash('sha256').update(`${window.storeId}:${sourceId}`).digest('hex').slice(0, 64),
          tenantId: window.tenantId,
          storeId: window.storeId,
          statementMonth,
          sourceId,
          payload: structuredClone(page.data),
          receivedAt,
        }).onDuplicateKeyUpdate({ set: { payload: structuredClone(page.data), statementMonth, receivedAt } });
      }

      await tx.delete(storageFees).where(and(eq(storageFees.tenantId, window.tenantId), eq(storageFees.storeId, window.storeId), gte(storageFees.month, range.from), lte(storageFees.month, range.to)));
      const feeRows = storageRows.map((row) => {
        const id = createHash('sha256').update(`${window.storeId}:${row.month}:${row.feeType}:${row.currency}:${normalizedReportSourceId}`).digest('hex').slice(0, 64);
        return { id, tenantId: window.tenantId, storeId: row.storeId, month: row.month, feeType: row.feeType, amount: String(row.amount), currency: row.currency, sourceId: normalizedReportSourceId, receivedAt };
      });
      for (let start = 0; start < feeRows.length; start += 250) {
        const chunk = feeRows.slice(start, start + 250);
        await tx.insert(storageFees).values(chunk).onDuplicateKeyUpdate({ set: {
          amount: sql.raw('VALUES(`amount`)'),
          receivedAt: sql.raw('VALUES(`received_at`)'),
        } });
      }

      const incoming = (column: string) => sql.raw(`VALUES(\`${column}\`)`);
      for (let start = 0; start < transactions.length; start += 250) {
        const chunk = transactions.slice(start, start + 250).map(row=>({...row,shipQty:row.shipQty==null?null:String(row.shipQty)}));
        await tx.insert(reconTransactions).values(chunk).onDuplicateKeyUpdate({ set: {
          reportMonth: incoming('report_month'),
          rowNumber: incoming('row_number'),
          customerOrderId: incoming('customer_order_id'),
          purchaseOrderId: incoming('purchase_order_id'),
          purchaseOrderLine: incoming('purchase_order_line'),
          shipQty: incoming('ship_qty'),
          billTransactionKey: incoming('bill_transaction_key'),
          sku: incoming('sku'),
          amountType: incoming('amount_type'),
          transactionId: incoming('transaction_id'),
          transactionDate: incoming('transaction_date'),
          periodStartDate: incoming('period_start_date'),
          periodEndDate: incoming('period_end_date'),
          description: incoming('description'),
          transactionType: incoming('transaction_type'),
          amount: incoming('amount'),
          currency: incoming('currency'),
          receivedAt: incoming('received_at'),
        } });
      }

      // Remove rows written by the prior page-scoped identity after the full report replacement.
      await tx.delete(reconTransactions).where(and(
        eq(reconTransactions.tenantId, window.tenantId),
        eq(reconTransactions.storeId, window.storeId),
        sql`${reconTransactions.sourceId} like ${`${normalizedReportSourceId}:%`}`,
      ));
    });

    return { resource: 'storage-fees', received: pages.length, normalized: storageRows.length, correlationId: reportDate, correlationIds };
  } finally {
    await pool.end();
  }
}
