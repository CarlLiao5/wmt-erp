import {createHash} from 'node:crypto';
import {reportCheckpoint,reportWait,reportReadyResponse,reportProgress} from '../reportContinuation.js';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAccessToken } from '../auth/token.js';
import { walmartRequest } from '../request.js';
import { retryDelay } from '../rateLimit.js';
import type { WalmartConnection, WalmartResponse } from '../types.js';

export interface SemReportRequest {
  page?: { offset: number; limit: number };
  sort?: { field: string; order: string };
  filters?: Array<{ field: string; values: string[] }>;
}

export interface SemAdvertisingRow {
  factDate: string;
  campaignId?: string;
  spend: number | null;
  attributedSales: number | null;
  attributedUnits: number | null;
  impressions: number | null;
  clicks: number | null;
  complete: boolean;
  acos: number | null;
  roas: number | null;
  channel: 'sem';
}

export interface SemItemAdvertisingRow {
  factDate: string;
  campaignId: string;
  sku: string;
  itemId?: string;
  spend: number | null;
  attributedSales: number | null;
  attributedUnits: number | null;
  impressions: number | null;
  clicks: number | null;
  complete: boolean;
  acos: number | null;
  roas: number | null;
  channel: 'sem';
}

export interface SemPerformanceDailyRow {
  reportDate: string;
  campaignId: string;
  campaignName: string | null;
  sku: string;
  itemId: string | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  adSpend: number | null;
  cpc: number | null;
  sales: number | null;
  roas: number | null;
}

export interface SemSearchTermRow {
  reportDate: string;
  campaignId: string;
  campaignName: string | null;
  searchTerm: string;
  sku: string;
  itemId: string | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  adSpend: number | null;
}

const execFileAsync = promisify(execFile);
const csvValue = (value: string): string => value.trim();
function parseCsv(content: Uint8Array | string): Record<string, string>[] {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() ?? []).map(csvValue); return rows.filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, csvValue(r[i] ?? '')])));
}
const numberOrNull = (value?: string): number | null => { if (!value?.trim()) return null; const n = Number(value.replace(/[$,%]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const dateValue = (value?: string): string => { if (!value) return ''; const iso = new Date(value); if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10); const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : value.slice(0, 10); };

export function normalizeSemPerformanceRows(content: Uint8Array | string): SemPerformanceDailyRow[] {
  return parseCsv(content).map((row) => ({ reportDate: dateValue(row.Date), campaignId: row['Campaign ID'] ?? '', campaignName: row['Campaign Name'] || null, sku: row.SKU ?? '', itemId: row['Item ID'] || null, impressions: numberOrNull(row.Impressions), clicks: numberOrNull(row.Clicks), ctr: numberOrNull(row['Average Click-Through Rate (CTR)'] ?? row.CTR), adSpend: numberOrNull(row['Ad Spend']), cpc: numberOrNull(row.CPC), sales: numberOrNull(row.Sales), roas: numberOrNull(row.ROAS) })).filter((row) => row.reportDate && row.sku);
}

export function normalizeSemSearchTermRows(content: Uint8Array | string): SemSearchTermRow[] {
  return parseCsv(content).map((row) => ({
    reportDate: dateValue(row.Date),
    campaignId: row['Campaign ID'] ?? '',
    campaignName: row['Campaign Name'] || null,
    searchTerm: row['Search Term'] ?? row['Seller Search Term'] ?? '',
    sku: row.SKU ?? '',
    itemId: row['Item ID'] || null,
    impressions: numberOrNull(row.Impressions),
    clicks: numberOrNull(row.Clicks),
    ctr: numberOrNull(row['Average Click-Through Rate (CTR)'] ?? row.CTR),
    adSpend: numberOrNull(row['Ad Spend']),
  })).filter((row) => row.reportDate && row.campaignId && row.searchTerm && row.sku);
}

async function executeReportRequest(connection: WalmartConnection, method: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  await reportProgress(method==='POST'?'正在申请 Walmart 报告':path.includes('/downloadReport')?'正在获取报告下载地址':'正在查询 Walmart 报告状态');
  let token = connection.accessToken;
  if (!token || (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt < Date.now() + 60_000)) token = (await getAccessToken(connection, fetcher)).accessToken;
  for (let attempt = 0; attempt < 5; attempt++) {
    const correlationId = randomUUID();
    const response = await walmartRequest(connection, path, { ...init, method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'WM_SEC.ACCESS_TOKEN': token, 'WM_QOS.CORRELATION_ID': correlationId, 'WM_CONSUMER.CHANNEL.TYPE': 'Walmart Marketplace', 'WM_SVC.NAME': 'Walmart Marketplace', 'WM_MARKET': 'us', 'WM_GLOBAL_VERSION': '3.1', ...(connection.environment === 'sandbox' ? { WM_SANDBOX: 'v2' } : {}), ...(init.headers ?? {}) } }, fetcher);
    if (response.ok) return response;
    if (response.status === 401 && attempt < 5) { token = (await getAccessToken(connection, fetcher)).accessToken; continue; }
    if (response.status === 429 && attempt < 5) {
      const waitMs = retryDelay(attempt, response.headers.get('Retry-After'), response.headers.get('X-Next-Replenishment-Time'));
      await reportWait(waitMs, 'api-rate-limit');
      continue;
    }
    throw new Error(`Walmart report request failed: ${method} ${path} (HTTP ${response.status}) ${(await response.clone().text()).slice(0, 500)}`);
  }
  throw new Error('Walmart report request exhausted retry budget after rate limiting');
}

export async function walmartReportRequest(connection: WalmartConnection, method: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  // Only cache submission receipts and terminal READY states. Signed download URLs
  // are deliberately refreshed and never stored in the continuation.
  const key=createHash('sha256').update(JSON.stringify([connection.environment,connection.clientId,method,path,init.body??''])).digest('hex');
  if(method==='POST') {
    const receipt=await reportCheckpoint(key,async()=>{
      const response=await executeReportRequest(connection,method,path,init,fetcher);
      const body=await response.text();
      const data=JSON.parse(body);
      if(!data.requestId&&!data.reportRequest?.requestId)throw Error('Walmart report submission did not return requestId');
      return {body,status:response.status,correlationId:response.headers.get('WM_QOS.CORRELATION_ID')??''};
    });
    return new Response(receipt.body,{status:receipt.status,headers:{'Content-Type':'application/json','WM_QOS.CORRELATION_ID':receipt.correlationId}});
  }
  if(/\/reportRequests\/[^/?]+$/.test(path)) {
    // A pending response is not a checkpoint: poll Walmart again on resumption.
    return reportReadyResponse(key,()=>executeReportRequest(connection,method,path,init,fetcher));
  }
  return executeReportRequest(connection,method,path,init,fetcher);
}
export async function requestSemPerformanceReport(connection: WalmartConnection, startDate: string, endDate: string, campaignIds?: string[], fetcher: typeof fetch = fetch): Promise<WalmartResponse<any>> {
  const rowFilters: any[] = [{ type: 'rangeFilter', columnName: 'Date', from: startDate, to: endDate }];
  if (campaignIds?.length) rowFilters.push({ type: 'multiValueFilter', columnName: 'Campaign ID', values: campaignIds });
  const response = await walmartReportRequest(connection, 'POST', '/v3/reports/reportRequests?reportType=SEM_PERFORMANCE&reportVersion=v1', { method: 'POST', body: JSON.stringify({ rowFilters }) }, fetcher);
  return { data: await response.json(), status: response.status, correlationId: response.headers.get('WM_QOS.CORRELATION_ID') ?? '', headers: response.headers };
}

export async function requestSemSearchTermsReport(connection: WalmartConnection, startDate: string, endDate: string, campaignIds?: string[], fetcher: typeof fetch = fetch): Promise<WalmartResponse<any>> {
  const rowFilters: any[] = [{ type: 'rangeFilter', columnName: 'Date', from: startDate, to: endDate }];
  if (campaignIds?.length) rowFilters.push({ type: 'multiValueFilter', columnName: 'Campaign ID', values: campaignIds });
  const response = await walmartReportRequest(connection, 'POST', '/v3/reports/reportRequests?reportType=SEM_SEARCH_TERMS&reportVersion=v1', { method: 'POST', body: JSON.stringify({ rowFilters }) }, fetcher);
  return { data: await response.json(), status: response.status, correlationId: response.headers.get('WM_QOS.CORRELATION_ID') ?? '', headers: response.headers };
}

export async function getSemReportStatus(connection: WalmartConnection, requestId: string, fetcher: typeof fetch = fetch): Promise<any> { const response = await walmartReportRequest(connection, 'GET', `/v3/reports/reportRequests/${encodeURIComponent(requestId)}`, {}, fetcher); return response.json(); }

export async function downloadSemReport(connection: WalmartConnection, requestId: string, fetcher: typeof fetch = fetch): Promise<{ content: Uint8Array; metadata: any }> {
  const response = await walmartReportRequest(connection, 'GET', `/v3/reports/downloadReport?requestId=${encodeURIComponent(requestId)}`, {}, fetcher); const metadata = await response.json(); const downloadUrl = metadata.downloadURL ?? metadata.downloadUrl ?? metadata.reportRequest?.downloadURL; if (!downloadUrl) throw new Error('SEM report download URL missing');
  await reportProgress('正在下载报告内容');
  const downloaded = await walmartRequest(connection, downloadUrl, {}, fetcher); if (!downloaded.ok) throw new Error(`SEM report download failed: ${downloaded.status}`); const content = new Uint8Array(await downloaded.arrayBuffer());
  if (content[0] !== 0x50 || content[1] !== 0x4b) return { content, metadata };
  const dir = await mkdtemp(join(tmpdir(), 'wm-sem-')); const zip = join(dir, 'report.zip'); const out = join(dir, 'out'); try { await writeFile(zip, content); await execFileAsync('unzip', ['-o', zip, '-d', out]); const { stdout } = await execFileAsync('find', [out, '-type', 'f', '-name', '*.csv']); const csv = stdout.trim().split('\n')[0]; if (!csv) throw new Error('SEM report ZIP has no CSV'); return { content: await readFile(csv), metadata }; } finally { await rm(dir, { recursive: true, force: true }); }
}

const arrayOf = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'items', 'itemDetails', 'itemLevelSummary', 'results', 'rows']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};

function metric(row: any, names: string[]): unknown {
  const traffic = row.traffic ?? row.metrics ?? row.performance ?? {};
  for (const source of [row, traffic]) {
    for (const name of names) if (source?.[name] != null) return source[name];
  }
  return null;
}

export function normalizeSemItemRows(payload: unknown, campaignId: string, factDate: string): SemItemAdvertisingRow[] {
  return arrayOf(payload).map((row: any) => {
    const sku = row.sku ?? row.SKU ?? row.itemSku ?? row.item?.sku ?? row.itemId ?? row.productId;
    const spendValue = metric(row, ['adspend', 'adSpend', 'spend', 'cost']);
    const salesValue = metric(row, ['gmv', 'attributedSales', 'attributedRevenue', 'sales']);
    const unitsValue = metric(row, ['attributedUnits', 'units', 'orders']);
    const spend = spendValue == null ? null : Number(spendValue);
    const attributedSales = salesValue == null ? null : Number(salesValue);
    const complete = spend != null && attributedSales != null;
    return {
      factDate: String(row.date ?? row.factDate ?? factDate).slice(0, 10),
      campaignId,
      sku: String(sku ?? ''),
      itemId: row.itemId == null ? undefined : String(row.itemId),
      spend,
      attributedSales,
      attributedUnits: unitsValue == null ? null : Number(unitsValue),
      impressions: metric(row, ['impressions', 'impression']) == null ? null : Number(metric(row, ['impressions', 'impression'])),
      clicks: metric(row, ['clicks', 'click']) == null ? null : Number(metric(row, ['clicks', 'click'])),
      complete,
      acos: complete && attributedSales !== 0 ? spend! / attributedSales! : null,
      roas: complete && spend !== 0 ? attributedSales! / spend! : null,
      channel: 'sem' as const,
    };
  }).filter((row) => row.sku && row.factDate);
}

export async function getSemItemPerformanceSummary(connection: WalmartConnection, campaignId: string, request: SemReportRequest = {}, fetcher: typeof fetch = fetch): Promise<WalmartResponse<unknown>> {
  const correlationId = randomUUID();
  let token = connection.accessToken;
  if (!token || (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt < Date.now() + 60_000)) token = (await getAccessToken(connection, fetcher)).accessToken;
  const response = await walmartRequest(connection, `/v3/advertising/sem/campaigns/${encodeURIComponent(campaignId)}/item-level-summary`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'WM_SEC.ACCESS_TOKEN': token,
      'WM_QOS.CORRELATION_ID': correlationId,
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_MARKET': 'us',
      'WM_GLOBAL_VERSION': '3.1',
      ...(connection.environment === 'sandbox' ? { 'WM_SANDBOX': 'v2' } : {}),
    },
    body: JSON.stringify(request),
  }, fetcher);
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.clone().text()).slice(0, 500); } catch { /* preserve status when body is unavailable */ }
    throw new Error(`Walmart SEM item report failed: ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  return { data: await response.json() as unknown, status: response.status, correlationId, headers: response.headers };
}

export function normalizeSemRows(payload: unknown): SemAdvertisingRow[] {
  const data = Array.isArray((payload as any)?.data) ? (payload as any).data : [];
  return data.map((row: any) => {
    const traffic = row.traffic ?? {};
    const spend = traffic.adspend == null ? null : Number(traffic.adspend);
    const attributedSales = traffic.gmv == null ? null : Number(traffic.gmv);
    const complete = spend != null && attributedSales != null;
    return {
      factDate: String(row.startDate ?? row.date ?? '').slice(0, 10),
      campaignId: row.campaignId == null ? undefined : String(row.campaignId),
      spend,
      attributedSales,
      attributedUnits: null,
      impressions: traffic.impressions == null ? null : Number(traffic.impressions),
      clicks: traffic.clicks == null ? null : Number(traffic.clicks),
      complete,
      acos: complete && attributedSales !== 0 ? spend! / attributedSales! : null,
      roas: complete && spend !== 0 ? attributedSales! / spend! : null,
      channel: 'sem',
    };
  }).filter((row: SemAdvertisingRow) => row.factDate);
}

export async function getSemPerformanceSummary(connection: WalmartConnection, request: SemReportRequest = {}, fetcher: typeof fetch = fetch): Promise<WalmartResponse<unknown>> {
  const correlationId = randomUUID();
  let token = connection.accessToken;
  if (!token || (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt < Date.now() + 60_000)) token = (await getAccessToken(connection, fetcher)).accessToken;
  const response = await walmartRequest(connection, '/v3/advertising/sem/campaigns/performance-summary', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'WM_SEC.ACCESS_TOKEN': token,
      'WM_QOS.CORRELATION_ID': correlationId,
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_MARKET': 'us',
      'WM_GLOBAL_VERSION': '3.1',
      ...(connection.environment === 'sandbox' ? { 'WM_SANDBOX': 'v2' } : {}),
    },
    body: JSON.stringify(request),
  }, fetcher);
  if (!response.ok) throw new Error(`Walmart SEM report failed: ${response.status}`);
  return { data: await response.json() as unknown, status: response.status, correlationId, headers: response.headers };
}
