import { downloadSemReport, getSemReportStatus, walmartReportRequest } from './sem.js';
import type { WalmartConnection } from '../types.js';

export interface WalmartItemReportRow {
  sku: string;
  productName: string | null;
  productId: string | null;
  brand: string | null;
  publishStatus: string | null;
  primaryImageUrl: string | null;
  fields: Record<string, string>;
}

export function parseCsv(content: Uint8Array | string, requiredHeaders: string[] = []): Record<string, string>[] {
  const text = (typeof content === 'string' ? content : new TextDecoder().decode(content)).replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (quoted) throw new Error('Malformed CSV: unclosed quoted field');
  const headers = (rows.shift() ?? []).map((header) => header.trim());
  for (const key of requiredHeaders) if (!headers.includes(key)) throw new Error('CSV missing column: ' + key);
  return rows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()])));
}

function field(fields: Record<string, string>, ...names: string[]): string | null {
  for (const name of names) {
    const value = fields[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function normalizeItemReportCsv(content: Uint8Array | string): WalmartItemReportRow[] {
  return parseCsv(content).map((fields) => ({
    sku: field(fields, 'SKU', 'Sku') ?? '',
    productName: field(fields, 'Product Name', 'Product name'),
    productId: field(fields, 'Item ID', 'Item Id', 'Product ID', 'Product Id'),
    brand: field(fields, 'Brand'),
    publishStatus: field(fields, 'Publish Status', 'Published Status'),
    primaryImageUrl: field(fields, 'Primary Image URL', 'Primary Image Url'),
    fields,
  })).filter((row) => row.sku.length > 0);
}

export async function requestItemReport(connection: WalmartConnection, fetcher: typeof fetch = fetch): Promise<{ requestId: string; reportType: string; status: string; createdTime?: string; correlationId: string }> {
  const response = await walmartReportRequest(connection, 'POST', '/v3/reports/reportRequests?reportType=ITEM&reportVersion=v1', { method: 'POST', body: JSON.stringify({ format: 'CSV' }) }, fetcher);
  const data = await response.json() as { requestId?: string; reportType?: string; status?: string; createdTime?: string };
  const requestId = data.requestId ?? (data as any).reportRequest?.requestId;
  if (!requestId) throw new Error('Walmart Item report request did not return requestId');
  return { ...data, requestId, reportType: data.reportType ?? 'ITEM', status: data.status ?? 'RECEIVED', correlationId: response.headers.get('WM_QOS.CORRELATION_ID') ?? '' };
}

export const getItemReportStatus = getSemReportStatus;
export const downloadItemReport = downloadSemReport;
