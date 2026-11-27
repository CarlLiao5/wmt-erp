export interface AggregateRow { storeId: string; date: string; metrics: Record<string, number>; }

export function aggregate(rows: Array<{ storeId: string; date: string; metrics: Record<string, number> }>): AggregateRow[] {
  const grouped = new Map<string, AggregateRow>();
  for (const row of rows) {
    const key = `${row.storeId}:${row.date}`;
    const current = grouped.get(key) ?? { storeId: row.storeId, date: row.date, metrics: {} };
    for (const [name, value] of Object.entries(row.metrics)) current.metrics[name] = (current.metrics[name] ?? 0) + value;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

export interface SalesLine { id: string; tenantId: string; storeId: string; orderId: string; sku: string; quantity?: number | null; amount?: number | null; orderedAt: string; rawResponseId: string; status?: string | null; }
import { isCancelledOrderStatus } from '../../../packages/domain/src/orderStatus.js';
export { isCancelledOrderStatus } from '../../../packages/domain/src/orderStatus.js';
export interface RefundLine { id: string; tenantId: string; storeId: string; orderId: string; sku: string; amount?: number; status: string; returnedAt: string; rawResponseId: string; }
export const SALES_TIME_ZONE = 'America/Los_Angeles';
export function salesDateInPacificTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SALES_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return fields.year + '-' + fields.month + '-' + fields.day;
}
export function dailySalesFacts(orders: SalesLine[], returns: RefundLine[]) {
  const groups = new Map<string, { tenantId: string; storeId: string; date: string; units: number; revenue: number; refunds: number; unitsComplete: boolean; revenueComplete: boolean; orderIds: Set<string>; returnIds: Set<string>; rawIds: Set<string> }>();
  const orderDates = new Map<string, string>();
  const group = (tenantId: string, storeId: string, date: string) => {
    const key = `${tenantId}:${storeId}:${date}`;
    let value = groups.get(key);
    if (!value) { value = { tenantId, storeId, date, units: 0, revenue: 0, refunds: 0, unitsComplete: true, revenueComplete: true, orderIds: new Set(), returnIds: new Set(), rawIds: new Set() }; groups.set(key, value); }
    return value;
  };
  for (const line of orders) { if (isCancelledOrderStatus(line.status)) continue; const date = salesDateInPacificTime(line.orderedAt); const fact = group(line.tenantId, line.storeId, date); orderDates.set(`${line.tenantId}:${line.storeId}:${line.orderId}:${line.sku}`, date); fact.orderIds.add(line.orderId); if (line.quantity == null) fact.unitsComplete = false; else fact.units += line.quantity; if (line.amount == null) fact.revenueComplete = false; else fact.revenue += line.amount; fact.rawIds.add(line.rawResponseId); }
  for (const line of returns) { const date = orderDates.get(`${line.tenantId}:${line.storeId}:${line.orderId}:${line.sku}`); if (!date) continue; const fact = group(line.tenantId, line.storeId, date); fact.returnIds.add(line.orderId); if (line.status === 'REFUNDED' && line.amount != null) fact.refunds += line.amount; fact.rawIds.add(line.rawResponseId); }
  return [...groups.values()].map(({ orderIds, returnIds, rawIds, unitsComplete, revenueComplete, ...fact }) => {
    const result = { ...fact, orders: orderIds.size, returns: returnIds.size, returnRate: fact.revenue && revenueComplete ? fact.refunds / fact.revenue : 0, rawResponseIds: [...rawIds] };
    Object.defineProperties(result, { unitsComplete: { value: unitsComplete }, revenueComplete: { value: revenueComplete } });
    return result;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function dailyFactRows(facts: ReturnType<typeof dailySalesFacts>) {
  return facts.flatMap((fact) => {
    const completeness = fact as typeof fact & { revenueComplete: boolean; unitsComplete: boolean };
    return [
    ...(completeness.revenueComplete ? [{ tenantId: fact.tenantId, storeId: fact.storeId, factDate: fact.date, metric: 'revenue', value: String(fact.revenue), currency: 'USD' }] : []),
    { tenantId: fact.tenantId, storeId: fact.storeId, factDate: fact.date, metric: 'orders', value: String(fact.orders), currency: null },
    ...(completeness.unitsComplete ? [{ tenantId: fact.tenantId, storeId: fact.storeId, factDate: fact.date, metric: 'units', value: String(fact.units), currency: null }] : []),
    { tenantId: fact.tenantId, storeId: fact.storeId, factDate: fact.date, metric: 'refunds', value: String(fact.refunds), currency: 'USD' },
  ]; });
}
