import { paginate } from '../pagination.js';
import { walmartGet } from '../transport.js';
import type { WalmartConnection } from '../types.js';
import { randomUUID } from 'node:crypto';
import { getAccessToken } from '../auth/token.js';
import { walmartRequest } from '../request.js';
export type PriceType = 'base' | 'incentive' | 'promotion';
export interface PriceRow { sku: string; price: number | null; currency?: string; effectiveAt?: string; promotion?: string; source: 'walmart'; priceType?: PriceType; targetPrice?: number | null; incentiveType?: string; incentiveStatus?: string; incentiveId?: string; startDate?: string; endDate?: string; buyBoxBasePrice?: number | null; buyBoxTotalPrice?: number | null; comparisonPrice?: number | null; competitorPrice?: number | null; promotionType?: string; showStrikethrough?: boolean | null; }
const rowsOf = (payload: any): any[] => Array.isArray(payload) ? payload : payload?.items ?? payload?.rows ?? payload?.data ?? [];
export function normalizePriceRows(payload: unknown): PriceRow[] { return rowsOf(payload).map((r) => ({ sku: String(r.sku ?? r.itemId ?? ''), price: r.price == null ? null : Number(r.price), currency: r.currency == null ? undefined : String(r.currency), effectiveAt: r.effectiveAt ?? r.updatedAt, promotion: r.promotion ?? r.promotionId, source: 'walmart' as const })).filter((r) => r.sku); }
const numberOrNull = (value: unknown) => value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value);
const dateValue = (value: unknown) => {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,}$/.test(value))) return new Date(Number(value)).toISOString();
  return String(value);
};
export function normalizePriceIncentiveRows(payload: unknown): PriceRow[] {
  return rowsOf(payload).map((r: any) => ({ sku: String(r.sku ?? r.skuId ?? r.itemId ?? ''), price: numberOrNull(r.currentPrice ?? r.price), targetPrice: numberOrNull(r.targetPrice), currency: r.currency ?? 'USD', effectiveAt: dateValue(r.startDate ?? r.enrollmentDate ?? r.updatedAt), promotion: r.incentiveId ?? r.incentiveType, incentiveType: r.incentiveType, incentiveStatus: r.incentiveStatus, incentiveId: r.incentiveId == null ? undefined : String(r.incentiveId), startDate: dateValue(r.startDate), endDate: dateValue(r.expirationDate ?? r.endDate), source: 'walmart' as const, priceType: 'incentive' as const })).filter((r) => r.sku);
}
export function normalizePromotionalPriceRows(payload: unknown, sku?: string): PriceRow[] {
  const body: any = payload;
  const itemSku = body?.payload?.itemIdentifier?.sku ?? body?.itemIdentifier?.sku ?? sku;
  const rows = body?.payload?.pricingList?.pricing ?? rowsOf(payload);
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({ sku: String(r.sku ?? r.skuId ?? itemSku ?? ''), price: numberOrNull(r.promotionalPrice ?? r.promoPrice ?? r.price ?? r.currentPrice?.value?.amount), targetPrice: numberOrNull(r.regularPrice ?? r.basePrice ?? r.comparisonPrice?.value?.amount), comparisonPrice: numberOrNull(r.comparisonPrice?.value?.amount), currency: r.currency ?? r.currentPrice?.value?.currency ?? r.comparisonPrice?.value?.currency ?? 'USD', effectiveAt: dateValue(r.startDate ?? r.effectiveAt ?? r.updatedAt ?? r.effectiveDate), promotion: r.promotionId ?? r.promotionName ?? r.promotion ?? r.promoId, promotionType: r.promotionType ?? r.promoType ?? r.dealType ?? r.currentPriceType ?? r.comparisonPriceType, showStrikethrough: r.priceDisplayCodes?.isStrikethrough ?? null, startDate: dateValue(r.startDate ?? r.effectiveDate), endDate: dateValue(r.endDate ?? r.expirationDate), source: 'walmart' as const, priceType: 'promotion' as const })).filter((r) => r.sku);
}
export function normalizePricingInsightRows(payload: unknown): PriceRow[] {
  const rows = (payload as any)?.pricingInsightsResponseList ?? (payload as any)?.data?.pricingInsightsResponseList ?? [];
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({ sku: String(r.sku ?? ''), price: numberOrNull(r.currentPrice), targetPrice: numberOrNull(r.suggestedPrice ?? r.comparisonPrice), buyBoxBasePrice: numberOrNull(r.buyBoxBasePrice), buyBoxTotalPrice: numberOrNull(r.buyBoxTotalPrice), comparisonPrice: numberOrNull(r.comparisonPrice), competitorPrice: numberOrNull(r.competitorPrice), currency: 'USD', effectiveAt: undefined, promotion: r.promoStatus ?? r.repricerStrategyName, promotionType: r.promoStatus ?? undefined, showStrikethrough: r.priceDisplayCodes?.isStrikethrough ?? null, incentiveStatus: r.reducedReferralStatus ?? r.walmartFundedStatus, source: 'walmart' as const, priceType: 'base' as const })).filter((r) => r.sku);
}
export function normalizePerformanceRows(payload: unknown): Array<{ metric: string; value: number | null; periodStart?: string; periodEnd?: string; complete: boolean }> { const rows = Array.isArray(payload) ? payload : (payload as any)?.metrics ?? (payload as any)?.rows ?? []; return rows.map((r: any) => ({ metric: String(r.metric ?? r.name ?? ''), value: r.value == null ? null : Number(r.value), periodStart: r.periodStart ?? r.startDate, periodEnd: r.periodEnd ?? r.endDate, complete: r.value != null })).filter((r: any) => r.metric); }
export const listPriceSnapshots = (c: WalmartConnection, q: Record<string,string>={}) => paginate<unknown>(c,'/v3/price',q);
export const listPriceIncentives = (c: WalmartConnection, q: Record<string,string>={}) => paginate<unknown>(c, '/v3/price/incentives', { incentiveStatus: 'ELIGIBLE', ...q });
export async function getPromotionalPrices(c: WalmartConnection, sku: string, fetcher?: typeof fetch) {
  const response = await walmartGet<unknown>(c, `/v3/promo/sku/${encodeURIComponent(sku)}`, { fetcher });
  return response.data;
}
export async function getPricingInsights(c: WalmartConnection, request: Record<string, unknown> = {}, fetcher: typeof fetch = fetch) {
  const correlationId = randomUUID();
  let token = c.accessToken;
  if (!token || (c.accessTokenExpiresAt && c.accessTokenExpiresAt < Date.now() + 60_000)) token = (await getAccessToken(c, fetcher)).accessToken;
  const response = await walmartRequest(c, '/v3/price/getPricingInsights', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'WM_SEC.ACCESS_TOKEN': token, 'WM_QOS.CORRELATION_ID': correlationId, 'WM_SVC.NAME': 'Walmart Marketplace', 'WM_MARKET': 'us', 'WM_GLOBAL_VERSION': '3.1', ...(c.environment === 'sandbox' ? { 'WM_SANDBOX': 'v2' } : {}) }, body: JSON.stringify({ pageNumber: 0, ...request }) }, fetcher);
  if (!response.ok) throw new Error(`Walmart pricing insights failed: ${response.status}`);
  return { data: await response.json() as unknown, status: response.status, correlationId, headers: response.headers };
}
