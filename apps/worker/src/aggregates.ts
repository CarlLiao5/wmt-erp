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

export interface SalesLine { id: string; tenantId: string; storeId: string; orderId: string; sku: string; quantity: number; amount: number; orderedAt: string; rawResponseId: string; }
export interface RefundLine { id: string; tenantId: string; storeId: string; orderId: string; sku: string; amount: number; status: string; returnedAt: string; rawResponseId: string; }
export function dailySalesFacts(orders: SalesLine[], returns: RefundLine[]) {
  const groups = new Map<string, { tenantId: string; storeId: string; date: string; units: number; revenue: number; refunds: number; orderIds: Set<string>; returnIds: Set<string>; rawIds: Set<string> }>();
  const orderDates = new Map<string, string>();
  const group = (tenantId: string, storeId: string, date: string) => {
    const key = `${tenantId}:${storeId}:${date}`;
    let value = groups.get(key);
    if (!value) { value = { tenantId, storeId, date, units: 0, revenue: 0, refunds: 0, orderIds: new Set(), returnIds: new Set(), rawIds: new Set() }; groups.set(key, value); }
    return value;
  };
  for (const line of orders) { const date = line.orderedAt.slice(0, 10); const fact = group(line.tenantId, line.storeId, date); orderDates.set(`${line.tenantId}:${line.storeId}:${line.orderId}:${line.sku}`, date); fact.orderIds.add(line.orderId); fact.units += line.quantity; fact.revenue += line.amount; fact.rawIds.add(line.rawResponseId); }
  for (const line of returns) { const date = orderDates.get(`${line.tenantId}:${line.storeId}:${line.orderId}:${line.sku}`); if (!date) continue; const fact = group(line.tenantId, line.storeId, date); fact.returnIds.add(line.orderId); if (line.status === 'REFUNDED') fact.refunds += line.amount; fact.rawIds.add(line.rawResponseId); }
  return [...groups.values()].map(({ orderIds, returnIds, rawIds, ...fact }) => ({ ...fact, orders: orderIds.size, returns: returnIds.size, returnRate: orderIds.size ? returnIds.size / orderIds.size : 0, rawResponseIds: [...rawIds] })).sort((a, b) => a.date.localeCompare(b.date));
}
