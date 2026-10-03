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
