import { createDb } from '@walmart-erp/db';

const pacificDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function createDailyProductProfitRollup() {
  const rows = new Map<string, { date: string; storeId: string; sku: string; profit: number }>();
  return {
    add(timestamp: Date | string, storeId: string, sku: string, profit: number) {
      const date = typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
        ? timestamp
        : pacificDay.format(new Date(typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(timestamp)
          ? timestamp.replace(' ', 'T') + 'Z' : timestamp));
      const key = JSON.stringify([date, storeId, sku]);
      const row = rows.get(key) ?? { date, storeId, sku, profit: 0 };
      row.profit += profit;
      rows.set(key, row);
    },
    rows: () => [...rows.values()],
  };
}

export async function loadProductProfit(tenantId: string, storeId: string, sku: string, from: string, to: string) {
  const [rows] = await createDb().pool.query(
    `SELECT COUNT(DISTINCT s.profit_month) AS coveredMonths, COALESCE(SUM(j.profit), 0) AS profit
     FROM monthly_profit_snapshots s
     LEFT JOIN JSON_TABLE(s.result, '$.dailyProductProfits[*]' COLUMNS(
       store_id VARCHAR(64) PATH '$.storeId',
       sku VARCHAR(255) PATH '$.sku',
       profit_date DATE PATH '$.date',
       profit DECIMAL(24,8) PATH '$.profit'
     )) j ON BINARY j.store_id = BINARY ? AND BINARY j.sku = BINARY ? AND j.profit_date BETWEEN ? AND ?
     WHERE s.tenant_id = ? AND s.profit_month BETWEEN ? AND ?
       AND s.calculated_at IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(s.result, '$.dailyProductProfits')) = 'ARRAY'`,
    [storeId, sku.trim().toUpperCase(), from, to, tenantId, from.slice(0, 7), to.slice(0, 7)],
  );
  const [row] = rows as Array<{ coveredMonths: number; profit: string }>;
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12
    + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  return Number(row.coveredMonths) === months ? Number(row.profit) : null;
}
