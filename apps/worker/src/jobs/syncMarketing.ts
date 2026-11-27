import {reportWait,reportProgress} from '../../../../packages/walmart-client/src/reportContinuation.js';
import { createHash, randomUUID } from 'node:crypto';
import { advertisingFacts, createDb, performanceSnapshots, priceSnapshots, rawPayloads, semItemAdvertisingFacts, semPerformanceDaily, semSearchTermsDaily } from '../../../../packages/db/index.js';
import { downloadSemReport, getPricingInsights, getPromotionalPrices, getSemItemPerformanceSummary, getSemPerformanceSummary, getSemReportStatus, listAdvertising, listPerformance, listPriceIncentives, normalizeAdvertisingRows, normalizePriceIncentiveRows, normalizePricingInsightRows, normalizePromotionalPriceRows, normalizeSemItemRows, normalizeSemRows, normalizeSemPerformanceRows, normalizeSemSearchTermRows, normalizeSellerPerformanceRows, requestSemPerformanceReport, requestSemSearchTermsReport, type PriceRow, type WalmartConnection } from '@walmart-erp/walmart-client';

const idFor = (...values: unknown[]) => createHash('sha256').update(values.map(String).join(':')).digest('hex').slice(0, 64);
export const semSearchTermId = (tenantId: string, storeId: string, row: { reportDate: string; campaignId: string; searchTerm: string; sku: string; itemId?: string | null }) =>
  idFor(tenantId, storeId, row.reportDate, row.campaignId, row.searchTerm.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'), row.sku.toLocaleUpperCase('en-US'), row.itemId ?? '');
const dateOnly = (value?: string) => value ? value.slice(0, 10) : null;

type ReportStatusLoader = (requestId: string) => Promise<any>;
type Delay = (milliseconds: number) => Promise<void>;
const reportDelay: Delay = (milliseconds) => reportWait(milliseconds);
const readyStatuses = ['READY', 'COMPLETED', 'SUCCESS'];
const failedStatuses = ['ERROR', 'FAILED'];

export async function waitForSemReport(requestId: string, loadStatus: ReportStatusLoader, sleep: Delay = reportDelay, initial: any = {}): Promise<{ status: string; response: any }> {
  let response = initial;
  let status = String(response?.reportRequest?.status ?? response?.status ?? response?.requestStatus ?? '').toUpperCase();
  for (let attempt = 0; !readyStatuses.includes(status) && attempt < 6; attempt++) {
    if (failedStatuses.includes(status)) throw new Error(`SEM report failed: ${status}`);
    response = await loadStatus(requestId);
    const envelope = response?.reportRequest ?? response;
    status = String(envelope?.status ?? envelope?.requestStatus ?? '').toUpperCase();
    if (readyStatuses.includes(status)) break;
    if (failedStatuses.includes(status)) throw new Error(`SEM report failed: ${status}`);
    await sleep(600_000);
  }
  if (!readyStatuses.includes(status)) throw new Error(`SEM report timed out: ${status || 'UNKNOWN'}`);
  return { status, response };
}
type Window = { tenantId: string; storeId: string; from: string; to: string; batchId?: string };

export function normalizeStoredPriceIncentivePayload(payload: unknown): PriceRow[] {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  return normalizePriceIncentiveRows({ items: [parsed] });
}

export async function loadPromotionalPricesForSkus<T, R>(skus: T[], load: (sku: T) => Promise<R>, onFailure: (sku: T, error: unknown) => void = () => {}) {
  const results: Array<{ sku: T; payload: R }> = [];
  for (const sku of skus) {
    try { results.push({ sku, payload: await load(sku) }); }
    catch (error) { onFailure(sku, error); }
  }
  return results;
}

export async function syncPricingToDatabase(window: Window, connection: WalmartConnection) {
  const { db, pool } = createDb(); const receivedAt = new Date(); let received = 0; let normalized = 0; const correlationIds: string[] = [];
    const save = async (resource: string, payload: unknown, rows: PriceRow[]) => { const sourceId = randomUUID(); await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: window.storeId, resource, externalId: sourceId, payload: structuredClone(payload), httpStatus: 200, correlationId: sourceId, receivedAt }); for (const row of rows) { const id = idFor(window.storeId, row.sku, row.priceType ?? 'base', row.incentiveId ?? row.promotion ?? '', sourceId); await db.insert(priceSnapshots).values({ id, tenantId: window.tenantId, storeId: window.storeId, sku: row.sku, price: row.price == null ? null : String(row.price), targetPrice: row.targetPrice == null ? null : String(row.targetPrice), buyBoxBasePrice: row.buyBoxBasePrice == null ? null : String(row.buyBoxBasePrice), buyBoxTotalPrice: row.buyBoxTotalPrice == null ? null : String(row.buyBoxTotalPrice), comparisonPrice: row.comparisonPrice == null ? null : String(row.comparisonPrice), competitorPrice: row.competitorPrice == null ? null : String(row.competitorPrice), currency: row.currency ?? null, priceType: row.priceType ?? 'base', promotion: row.promotion ?? null, promotionType: row.promotionType ?? null, showStrikethrough: row.showStrikethrough == null ? null : row.showStrikethrough ? 1 : 0, incentiveType: row.incentiveType ?? null, incentiveStatus: row.incentiveStatus ?? null, incentiveId: row.incentiveId ?? null, startDate: row.startDate ? new Date(row.startDate) : null, endDate: row.endDate ? new Date(row.endDate) : null, effectiveAt: row.effectiveAt ? new Date(row.effectiveAt) : null, sourceId, payload: structuredClone(payload), receivedAt }).onDuplicateKeyUpdate({ set: { price: row.price == null ? null : String(row.price), targetPrice: row.targetPrice == null ? null : String(row.targetPrice), buyBoxBasePrice: row.buyBoxBasePrice == null ? null : String(row.buyBoxBasePrice), buyBoxTotalPrice: row.buyBoxTotalPrice == null ? null : String(row.buyBoxTotalPrice), comparisonPrice: row.comparisonPrice == null ? null : String(row.comparisonPrice), competitorPrice: row.competitorPrice == null ? null : String(row.competitorPrice), currency: row.currency ?? null, promotion: row.promotion ?? null, promotionType: row.promotionType ?? null, showStrikethrough: row.showStrikethrough == null ? null : row.showStrikethrough ? 1 : 0, incentiveType: row.incentiveType ?? null, incentiveStatus: row.incentiveStatus ?? null, incentiveId: row.incentiveId ?? null, startDate: row.startDate ? new Date(row.startDate) : null, endDate: row.endDate ? new Date(row.endDate) : null, effectiveAt: row.effectiveAt ? new Date(row.effectiveAt) : null, receivedAt, payload: structuredClone(payload) } }); normalized++; } received++; correlationIds.push(sourceId); };
  try {
    try { const insights = await getPricingInsights(connection, { pageNumber: 0 }); await save('pricing-insights', insights.data, normalizePricingInsightRows(insights.data)); } catch { /* optional source; preserve successful price sources */ }
    try { for await (const payload of listPriceIncentives(connection, { from: window.from, to: window.to })) await save('pricing-incentives', payload, normalizePriceIncentiveRows({ items: [payload] })); } catch (error) { console.error('[syncPricing] pricing-incentives failed', error instanceof Error ? error.message : error); }
    // Incentives fetched in this window are normalized by the save() call above.
    // Do not rescan every historical raw JSON payload here: that made each
    // incremental run grow linearly with the archive and duplicated snapshots.
    const [skuRows] = await pool.query('SELECT DISTINCT external_id AS sku FROM skus WHERE tenant_id = ? AND store_id = ?', [window.tenantId, window.storeId]) as [{ sku: string }[], unknown];
    const promotionFailures: string[] = [];
    const promotionResults = await loadPromotionalPricesForSkus(skuRows.map(({ sku }) => sku), (sku) => getPromotionalPrices(connection, sku), (sku, error) => {
      const message = error instanceof Error ? error.message : String(error);
      promotionFailures.push(`${sku}: ${message}`);
      console.error(`[syncPricing] pricing-promotions failed for SKU ${sku}: ${message}`);
    });
    for (const result of promotionResults) await save('pricing-promotions', result.payload, normalizePromotionalPriceRows(result.payload, result.sku));
    if (received === 0 && promotionFailures.length > 0) throw new Error(`Pricing promotions unavailable for ${promotionFailures.length} SKU(s): ${promotionFailures.slice(0, 5).join('; ')}`);
    return { resource: 'pricing', received, normalized, correlationIds, promotionFailures };
  } finally { await pool.end(); }
}

export async function syncAdvertisingToDatabase(window: Window, connection: WalmartConnection, channel: 'onsite' | 'sem' = 'onsite') {
  const { db, pool } = createDb(); const receivedAt = new Date(); let received = 0; let normalized = 0; const correlationIds: string[] = [];
  try { const payloads: unknown[] = []; if (channel === 'sem') { const response = await getSemPerformanceSummary(connection, { page: { offset: 0, limit: 200 }, sort: { field: 'gmv', order: 'DESC' } }); payloads.push(response.data); } else { for await (const payload of listAdvertising(connection, { from: window.from, to: window.to })) payloads.push(payload); } const sourceId = randomUUID(); await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: window.storeId, resource: channel === 'sem' ? 'advertising-sem' : 'advertising', externalId: sourceId, payload: structuredClone(payloads), httpStatus: 200, correlationId: sourceId, receivedAt }); const rows = channel === 'sem' ? normalizeSemRows(payloads[0]) : normalizeAdvertisingRows({ rows: payloads }); for (const row of rows) { const id = channel === 'sem' ? idFor(window.tenantId, window.storeId, channel, row.factDate, row.campaignId ?? '') : idFor(window.storeId, channel, row.factDate, row.campaignId ?? '', sourceId); await db.insert(advertisingFacts).values({ id, tenantId: window.tenantId, storeId: window.storeId, channel, factDate: new Date(`${row.factDate}T00:00:00.000Z`), campaignId: row.campaignId ?? null, spend: row.spend == null ? null : String(row.spend), attributedSales: row.attributedSales == null ? null : String(row.attributedSales), attributedUnits: row.attributedUnits == null ? null : String(row.attributedUnits), impressions: row.impressions, clicks: row.clicks, complete: row.complete ? 1 : 0, sourceId, payload: structuredClone(row), receivedAt, currency: 'USD' }).onDuplicateKeyUpdate({ set: { spend: row.spend == null ? null : String(row.spend), attributedSales: row.attributedSales == null ? null : String(row.attributedSales), attributedUnits: row.attributedUnits == null ? null : String(row.attributedUnits), impressions: row.impressions, clicks: row.clicks, complete: row.complete ? 1 : 0, sourceId, payload: structuredClone(row), receivedAt } }); normalized++; } received = payloads.length; correlationIds.push(sourceId); return { resource: channel === 'sem' ? 'advertising-sem' : 'advertising', received, normalized, correlationIds }; } finally { await pool.end(); }
}

export async function syncSemItemAdvertisingToDatabase(window: Window, connection: WalmartConnection) {
  const { db, pool } = createDb(); const receivedAt = new Date(); let received = 0; let normalized = 0; const correlationIds: string[] = [];
  const failures: string[] = [];
  const periodStart = window.from.slice(0, 10); const periodEnd = window.to.slice(0, 10);
  try {
    const [campaignRows] = await pool.query('SELECT DISTINCT campaign_id AS campaignId FROM advertising_facts WHERE tenant_id = ? AND store_id = ? AND channel = ? AND campaign_id IS NOT NULL', [window.tenantId, window.storeId, 'sem']) as [{ campaignId: string | null }[], unknown];
    const campaigns = campaignRows;
    for (const campaign of campaigns) {
      if (!campaign.campaignId) continue;
      try {
          const response = await getSemItemPerformanceSummary(connection, campaign.campaignId, { page: { offset: 0, limit: 200 }, sort: { field: 'adspend', order: 'DESC' }, filters: [{ field: 'duration', values: ['LAST_30_DAYS'] }] });
          const sourceId = idFor(window.storeId, 'advertising-sem-items', campaign.campaignId, periodStart, periodEnd);
          await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: window.storeId, resource: 'advertising-sem-items', externalId: sourceId, payload: structuredClone(response.data), httpStatus: response.status, correlationId: response.correlationId, receivedAt });
          const rows = normalizeSemItemRows(response.data, campaign.campaignId, periodEnd);
          for (const row of rows) {
            const id = idFor(window.storeId, campaign.campaignId, row.sku, row.factDate);
            await db.insert(semItemAdvertisingFacts).values({ id, tenantId: window.tenantId, storeId: window.storeId, campaignId: campaign.campaignId, sku: row.sku, itemId: row.itemId ?? null, factDate: new Date(`${periodEnd}T00:00:00.000Z`), periodStart: new Date(`${periodStart}T00:00:00.000Z`), periodEnd: new Date(`${periodEnd}T00:00:00.000Z`), spend: row.spend == null ? null : String(row.spend), attributedSales: row.attributedSales == null ? null : String(row.attributedSales), impressions: row.impressions, clicks: row.clicks, attributedUnits: row.attributedUnits, currency: 'USD', complete: row.complete ? 1 : 0, sourceId, payload: structuredClone(row), receivedAt }).onDuplicateKeyUpdate({ set: { itemId: row.itemId ?? null, periodStart: new Date(`${periodStart}T00:00:00.000Z`), periodEnd: new Date(`${periodEnd}T00:00:00.000Z`), spend: row.spend == null ? null : String(row.spend), attributedSales: row.attributedSales == null ? null : String(row.attributedSales), impressions: row.impressions, clicks: row.clicks, attributedUnits: row.attributedUnits, complete: row.complete ? 1 : 0, payload: structuredClone(row), receivedAt } });
            normalized++;
          }
          received++; correlationIds.push(response.correlationId);
      } catch (error) {
        // A missing report for one campaign must not block other campaigns.
        failures.push(`${campaign.campaignId}/${periodStart}:${periodEnd}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (received === 0 && failures.length > 0) throw new Error(`SEM item reports unavailable (${failures.length} failures): ${failures[0]}`);
    return { resource: 'advertising-sem-items', received, normalized, correlationIds, failures };
  } finally { await pool.end(); }
}

export async function syncSemPerformanceToDatabase(window: Window, connection: WalmartConnection) {
  const { db, pool } = createDb(); const receivedAt = new Date();
  try {
    const requested = await requestSemPerformanceReport(connection, window.from.slice(0, 10), window.to.slice(0, 10));
    const requestId = String(requested.data?.requestId ?? requested.data?.reportRequest?.requestId ?? '');
    if (!requestId) throw new Error('SEM performance report did not return requestId');
    const { status } = await waitForSemReport(requestId, (id) => getSemReportStatus(connection, id), reportDelay, requested.data);
    const report = await downloadSemReport(connection, requestId); await reportProgress('正在标准化入库'); const rows = normalizeSemPerformanceRows(report.content); const sourceId = `sem-performance:${requestId}`;
    await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: window.storeId, resource: 'advertising-sem-performance', externalId: sourceId, payload: { requestId, status, metadata: report.metadata, rows }, httpStatus: 200, correlationId: requestId, receivedAt });
    let normalized = 0;
    for (const row of rows) { const id = idFor(window.storeId, row.reportDate, row.campaignId, row.sku, sourceId); await db.insert(semPerformanceDaily).values({ id, tenantId: window.tenantId, storeId: window.storeId, reportDate: new Date(`${row.reportDate}T00:00:00.000Z`), campaignId: row.campaignId, campaignName: row.campaignName, sku: row.sku, itemId: row.itemId, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr == null ? null : String(row.ctr), adSpend: row.adSpend == null ? null : String(row.adSpend), cpc: row.cpc == null ? null : String(row.cpc), sales: row.sales == null ? null : String(row.sales), roas: row.roas == null ? null : String(row.roas), currency: 'USD', sourceId, payload: structuredClone(row), receivedAt }).onDuplicateKeyUpdate({ set: { campaignName: row.campaignName, itemId: row.itemId, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr == null ? null : String(row.ctr), adSpend: row.adSpend == null ? null : String(row.adSpend), cpc: row.cpc == null ? null : String(row.cpc), sales: row.sales == null ? null : String(row.sales), roas: row.roas == null ? null : String(row.roas), payload: structuredClone(row), receivedAt } }); normalized++; }
    return { resource: 'advertising-sem-performance', requestId, received: 1, normalized, reportRows: rows.length, correlationIds: [requestId] };
  } finally { await pool.end(); }
}

export async function syncSemSearchTermsToDatabase(window: Window, connection: WalmartConnection) {
  const { db, pool } = createDb(); const receivedAt = new Date();
  try {
    const requested = await requestSemSearchTermsReport(connection, window.from.slice(0, 10), window.to.slice(0, 10));
    const requestId = String(requested.data?.requestId ?? requested.data?.reportRequest?.requestId ?? '');
    if (!requestId) throw new Error('SEM search terms report did not return requestId');
    const { status } = await waitForSemReport(requestId, (id) => getSemReportStatus(connection, id), reportDelay, requested.data);
    const report = await downloadSemReport(connection, requestId); await reportProgress('正在标准化入库'); const rows = normalizeSemSearchTermRows(report.content); const sourceId = `sem-search-terms:${requestId}`;
    await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: window.storeId, resource: 'advertising-sem-search-terms', externalId: sourceId, payload: { requestId, status, metadata: report.metadata, rows }, httpStatus: 200, correlationId: requestId, receivedAt });
    let normalized = 0;
    for (const row of rows) {
      const id = semSearchTermId(window.tenantId, window.storeId, row);
      await db.insert(semSearchTermsDaily).values({ id, tenantId: window.tenantId, storeId: window.storeId, reportDate: new Date(`${row.reportDate}T00:00:00.000Z`), campaignId: row.campaignId, campaignName: row.campaignName, searchTerm: row.searchTerm, sku: row.sku, itemId: row.itemId, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr == null ? null : String(row.ctr), adSpend: row.adSpend == null ? null : String(row.adSpend), currency: 'USD', sourceId, payload: structuredClone(row), receivedAt }).onDuplicateKeyUpdate({ set: { campaignName: row.campaignName, itemId: row.itemId, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr == null ? null : String(row.ctr), adSpend: row.adSpend == null ? null : String(row.adSpend), payload: structuredClone(row), receivedAt } });
      normalized++;
    }
    return { resource: 'advertising-sem-search-terms', requestId, received: 1, normalized, reportRows: rows.length, correlationIds: [requestId] };
  } finally { await pool.end(); }
}

export async function syncPerformanceToDatabase(window: Window, connection: WalmartConnection) {
  const { db, pool } = createDb(); const receivedAt = new Date(); let received = 0; let normalized = 0; const correlationIds: string[] = [];
  try { for await (const payload of listPerformance(connection)) { const sourceId = randomUUID(); await db.insert(rawPayloads).values({ tenantId: window.tenantId, storeId: window.storeId, resource: 'performance', externalId: sourceId, payload: structuredClone(payload), httpStatus: 200, correlationId: sourceId, receivedAt }); for (const row of normalizeSellerPerformanceRows(payload)) { const windowDays = Number(row.metric.match(/^(7|14|30|60|90)DAY\./)?.[1] ?? 0); const periodEnd = new Date(Date.UTC(receivedAt.getUTCFullYear(), receivedAt.getUTCMonth(), receivedAt.getUTCDate())); const periodStart = windowDays ? new Date(periodEnd) : null; if (periodStart) periodStart.setUTCDate(periodStart.getUTCDate() - windowDays + 1); const id = idFor(window.storeId, row.metric, periodEnd.toISOString().slice(0, 10), sourceId); await db.insert(performanceSnapshots).values({ id, tenantId: window.tenantId, storeId: window.storeId, metric: row.metric, value: row.value == null ? null : String(row.value), periodStart, periodEnd, complete: row.complete ? 1 : 0, sourceId, payload: structuredClone(payload), receivedAt, currency: null }).onDuplicateKeyUpdate({ set: { value: row.value == null ? null : String(row.value), complete: row.complete ? 1 : 0, periodStart, periodEnd, receivedAt, payload: structuredClone(payload) } }); normalized++; } received++; correlationIds.push(sourceId); } return { resource: 'performance', received, normalized, correlationIds }; } finally { await pool.end(); }
}
