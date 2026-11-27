import { createHash } from 'node:crypto';
import { walmartGet } from '../transport.js';
import type { WalmartConnection } from '../types.js';

export interface StorageFeeRow { storeId: string; month: string; feeType: string; amount: number; currency: string; }

const RECON_AVAILABLE_PATH = '/v3/report/reconreport/availableReconFiles';
const RECON_JSON_PATH = '/v3/report/reconreport/reconFileJson';

function reconKeyName(value: string): string { return value.replace(/[^a-z0-9]/gi, '').toLowerCase(); }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function reconValueFor(object: Record<string, unknown>, names: string[]): unknown {
  const wanted = new Set(names.map(reconKeyName));
  const entry = Object.entries(object).find(([key]) => wanted.has(reconKeyName(key)));
  return entry?.[1];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, '').trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (isObject(value)) return numberValue(reconValueFor(value, ['value', 'amount', 'currencyAmount', 'total']));
  return undefined;
}

function normalizeReportDate(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (/^\d{8}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[2]}${iso[3]}${iso[1]}` : undefined;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (isObject(value)) return dateValue(reconValueFor(value, ['value', 'date', 'timestamp', 'dateValue']));
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compact) return new Date(Date.UTC(Number(compact[3]), Number(compact[1]) - 1, Number(compact[2])));
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  return null;
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export interface ReconTransactionContext {
  tenantId: string;
  storeId: string;
  reportDate: string;
  sourceId: string;
  receivedAt: Date;
  rowOffset?: number;
}

export interface NormalizedReconTransaction {
  id: string;
  tenantId: string;
  storeId: string;
  reportMonth: string;
  sourceId: string;
  transactionKey: string;
  rowNumber: number;
  customerOrderId: string | null;
  purchaseOrderId: string | null;
  purchaseOrderLine: string | null;
  shipQty: number | null;
  billTransactionKey: string | null;
  sku: string | null;
  amountType: string | null;
  transactionId: string | null;
  transactionDate: Date | null;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  description: string;
  transactionType: string | null;
  amount: string;
  currency: string;
  receivedAt: Date;
}

export function normalizeReconTransactions(payload: unknown, context: ReconTransactionContext): NormalizedReconTransaction[] {
  const fallbackMonth = reconReportMonth(context.reportDate);
  if (!fallbackMonth) return [];
  const rowOffset = Math.max(0, Math.floor(context.rowOffset ?? 0));
  return reconTransactionRows(payload).flatMap((row, index) => {
    const amount = numberValue(reconValueFor(row, ['amount', 'transactionAmount', 'feeAmount', 'total']));
    if (amount === undefined) return [];
    const rawDescription = String(reconValueFor(row, ['transactionDescription', 'description']) ?? '').trim();
    const description = reconKeyName(rawDescription) === 'wfsstoragefee' ? 'WFS StorageFee' : rawDescription;
    const transactionType = String(reconValueFor(row, ['transactionType', 'type']) ?? '').trim() || null;
    const transactionId = String(reconValueFor(row, ['transactionId', 'transactionIdentifier', 'referenceId', 'orderId']) ?? '').trim() || null;
    const periodStartDate = dateValue(reconValueFor(row, ['periodStartDate', 'periodStart']));
    const periodEndDate = dateValue(reconValueFor(row, ['periodEndDate', 'periodEnd']));
    const transactionDate = dateValue(reconValueFor(row, ['transactionPostedTimestamp', 'transactionDate', 'postedDate', 'transactionTimestamp'])) ?? periodEndDate;
    const reportMonth = (periodEndDate ?? transactionDate)?.toISOString().slice(0, 7)
      ?? reconReportMonth(reconValueFor(row, ['transactionPostedTimestamp', 'transactionDate', 'postedDate']))
      ?? fallbackMonth;
    const currency = String(reconValueFor(row, ['currency', 'currencyCode']) ?? 'USD').trim().toUpperCase() || 'USD';
    const rowNumber = rowOffset + index + 1;
    const transactionKey = sha256(`${context.sourceId}:row:${rowNumber}`);
    return [{
      id: sha256(`${context.tenantId}:${context.storeId}:${context.sourceId}:${transactionKey}`).slice(0, 64),
      tenantId: context.tenantId,
      storeId: context.storeId,
      reportMonth,
      sourceId: context.sourceId,
      transactionKey,
      rowNumber,
      customerOrderId: String(reconValueFor(row, ['Customer Order #', 'customerOrderId']) ?? '').trim() || null,
      purchaseOrderId: String(reconValueFor(row, ['Purchase Order #', 'purchaseOrderId']) ?? '').trim() || null,
      purchaseOrderLine: String(reconValueFor(row, ['Purchase Order line #', 'purchaseOrderLine']) ?? '').trim() || null,
      shipQty: numberValue(reconValueFor(row, ['Ship Qty', 'shipQty'])) ?? null,
      billTransactionKey: String(reconValueFor(row, ['Transaction Key', 'billTransactionKey']) ?? '').trim() || null,
      sku: String(reconValueFor(row, ['Partner Item Id', 'sku']) ?? '').trim() || null,
      amountType: String(reconValueFor(row, ['Amount Type', 'amountType']) ?? '').trim() || null,
      transactionId,
      transactionDate,
      periodStartDate,
      periodEndDate,
      description: description || transactionType || 'Unclassified',
      transactionType,
      amount: String(amount),
      currency,
      receivedAt: context.receivedAt,
    }];
  });
}

export function reconReportMonth(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  // Recon rows use US month/day/year dates; the report date itself uses MMDDYYYY.
  const slash = raw.match(/^(\d{2})[/-]\d{2}[/-](\d{4})$/);
  if (slash) return `${slash[2]}-${slash[1]}`;
  const iso = raw.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const compact = normalizeReportDate(raw);
  return compact ? `${compact.slice(4)}-${compact.slice(0, 2)}` : undefined;
}

function walkStrings(value: unknown, result: string[]): void {
  if (typeof value === 'string') { result.push(value); return; }
  if (Array.isArray(value)) { value.forEach((item) => walkStrings(item, result)); return; }
  if (isObject(value)) Object.values(value).forEach((item) => walkStrings(item, result));
}

function walkObjects(value: unknown, result: Record<string, unknown>[]): void {
  if (Array.isArray(value)) { value.forEach((item) => walkObjects(item, result)); return; }
  if (!isObject(value)) return;
  const hasTransactionDescription = Object.keys(value).some((key) => reconKeyName(key) === 'transactiondescription');
  const periodEnd = reconValueFor(value, ['periodEndDate', 'periodEnd']);
  const amount = reconValueFor(value, ['amount', 'transactionAmount', 'feeAmount', 'total']);
  if (hasTransactionDescription || (periodEnd !== undefined && amount !== undefined)) {
    result.push(value);
    return;
  }
  Object.values(value).forEach((item) => walkObjects(item, result));
}

export function reconTransactionRows(payload: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  walkObjects(payload, rows);
  return rows;
}

export function reconNextOffset(payload: unknown, currentOffset: number, requestedRecords: number): number | undefined {
  const values: unknown[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (['nextoffset', 'nextstart', 'nextposition'].includes(reconKeyName(key))) values.push(child);
      else collect(child);
    }
  };
  collect(payload);
  const explicit = values.map(numberValue).find((value) => value !== undefined && value > currentOffset);
  if (explicit !== undefined) return explicit;

  const records = reconTransactionRows(payload).length;
  const hasMore = (() => {
    const flags: unknown[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!isObject(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (['hasmore', 'hasmorerows', 'hasmorerecords', 'more'].includes(reconKeyName(key))) flags.push(child);
        else visit(child);
      }
    };
    visit(payload);
    return flags.some((flag) => flag === true || String(flag).toLowerCase() === 'true');
  })();
  if (hasMore && records > 0) return currentOffset + records;

  const totals: unknown[] = [];
  const visitTotals = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visitTotals); return; }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (['totalrecords', 'totalcount', 'recordcount'].includes(reconKeyName(key))) totals.push(child);
      else visitTotals(child);
    }
  };
  visitTotals(payload);
  const total = totals.map(numberValue).find((value) => value !== undefined);
  if (total !== undefined && currentOffset + records < total && records > 0) return currentOffset + records;
  if (records >= requestedRecords && records > 0) return currentOffset + records;
  return undefined;
}

function feeLines(payload: any): any[] {
  const candidates = [payload?.statement?.transactions, payload?.statement?.fees, payload?.transactions, payload?.fees, payload?.data?.transactions, payload?.data?.fees, payload?.payload?.transactions, payload?.payload?.fees];
  return candidates.find(Array.isArray) ?? [];
}

function wfsFeeLine(payload: any): any[] {
  const wfs = payload?.payload?.transactionDetails?.wfs ?? payload?.transactionDetails?.wfs;
  const value = wfs?.wfsStorageFee ?? wfs?.['WFS StorageFee'] ?? wfs?.['WFS Storage Fee'];
  return value == null ? [] : [{ feeType: 'wfsStorageFee', amount: Math.abs(Number(value)) }];
}

export function normalizeStorageFees(payload: unknown, storeId: string): StorageFeeRow[] {
  const root: any = payload;
  const statementDate = String(root?.statement?.statementDate ?? root?.statementDate ?? root?.data?.statementDate ?? new Date().toISOString()).slice(0, 7);
  const currency = String(root?.statement?.currency ?? root?.currency ?? root?.data?.currency ?? 'USD').toUpperCase();
  return [...feeLines(root), ...wfsFeeLine(root)].flatMap((line: any) => {
    const feeType = String(line.feeType ?? line.feeCategory ?? line.description ?? line.type ?? '').trim();
    const label = feeType.toLowerCase();
    if (!feeType || (!label.includes('storage') && !label.includes('warehous'))) return [];
    const amount = Math.abs(Number(line.amount ?? line.feeAmount ?? line.total ?? line.value));
    return Number.isFinite(amount) ? [{ storeId, month: statementDate, feeType, amount, currency }] : [];
  });
}

export async function getPaymentStatement(c: WalmartConnection, fetcher?: typeof fetch) {
  return walmartGet<any>(c, '/v3/report/payment/statement', { fetcher });
}

export async function getAvailableReconReportDates(c: WalmartConnection, fetcher?: typeof fetch): Promise<string[]> {
  const response = await walmartGet<any>(c, RECON_AVAILABLE_PATH, { query: { reportVersion: 'v1' }, fetcher });
  const values: string[] = [];
  walkStrings(response.data, values);
  return [...new Set(values.map(normalizeReportDate).filter((value): value is string => !!value))];
}

export async function getReconReportPage(c: WalmartConnection, reportDate: string, offset = 0, noOfRecords = 1000, fetcher?: typeof fetch) {
  return walmartGet<any>(c, RECON_JSON_PATH, {
    query: { reportDate, offset: String(Math.max(0, offset)), noOfRecords: String(Math.min(1000, Math.max(1, noOfRecords))) },
    fetcher,
  });
}

export function normalizeReconStorageFees(payload: unknown, storeId: string, reportDate: string): StorageFeeRow[] {
  const fallbackMonth = reconReportMonth(reportDate) ?? new Date().toISOString().slice(0, 7);
  const rows = reconTransactionRows(payload);
  return rows.flatMap((row) => {
    const description = String(reconValueFor(row, ['transactionDescription', 'description']) ?? '').trim();
    if (reconKeyName(description) !== 'wfsstoragefee') return [];
    const amount = numberValue(reconValueFor(row, ['amount', 'transactionAmount', 'feeAmount', 'total']));
    if (amount === undefined) return [];
    const periodEnd = dateValue(reconValueFor(row, ['periodEndDate', 'periodEnd']));
    const month = periodEnd?.toISOString().slice(0, 7) ?? reconReportMonth(reconValueFor(row, ['transactionPostedTimestamp'])) ?? fallbackMonth;
    const currency = String(reconValueFor(row, ['currency', 'currencyCode']) ?? 'USD').trim().toUpperCase() || 'USD';
    return [{ storeId, month, feeType: 'wfsStorageFee', amount: Math.abs(amount), currency }];
  });
}
