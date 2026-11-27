import { createDb } from '@walmart-erp/db';
import type { DashboardRow } from './dashboard.js';

const pacificDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function mergeSnapshotProfit(rows: DashboardRow[], entries: Array<{timestamp: string; amount: string; incomplete: number}>, from: string, to: string) {
  const byDate = new Map(rows.map(row => [row.date, {...row, profit: null, estimated: true} as DashboardRow]));
  for (const entry of entries) {
    const timestamp = entry.timestamp;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(timestamp) ? timestamp : pacificDate.format(new Date(
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(timestamp) ? timestamp.replace(' ', 'T')+'Z' : timestamp,
    ));
    if (date < from || date > to) continue;
    const row = byDate.get(date) ?? {date, revenue:0, orders:0, units:0, estimated:false};
    if (row.profit == null) row.estimated = false;
    row.profit = (row.profit ?? 0) + Number(entry.amount);
    row.estimated ||= Boolean(entry.incomplete);
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
}

export async function loadDashboardProfit(tenant: string, from: string, to: string, store?: string) {
  const {pool} = createDb();
  const [rows] = await pool.query(
    `SELECT j.ordered_at AS timestamp, j.profit AS amount, COALESCE(j.incomplete,0)>0 AS incomplete
     FROM monthly_profit_snapshots s JOIN JSON_TABLE(s.result, '$.orders[*]' COLUMNS(
       store_id VARCHAR(64) PATH '$.storeId',
       ordered_at VARCHAR(40) PATH '$.orderedAt',
       profit DECIMAL(24,8) PATH '$.profitBeforeReturns',
       incomplete INT PATH '$.incomplete'
     )) j WHERE s.tenant_id=? AND s.profit_month BETWEEN ? AND ? AND s.calculated_at IS NOT NULL AND j.ordered_at IS NOT NULL AND j.profit IS NOT NULL AND (? IS NULL OR j.store_id COLLATE utf8mb4_0900_ai_ci=?)
     UNION ALL
     SELECT j.returned_at, -j.deduction, 0
     FROM monthly_profit_snapshots s JOIN JSON_TABLE(s.result, '$.returns.rows[*]' COLUMNS(
       store_id VARCHAR(64) PATH '$.storeId',
       returned_at VARCHAR(40) PATH '$.returnedAt',
       deduction DECIMAL(24,8) PATH '$.netDeduction'
     )) j WHERE s.tenant_id=? AND s.profit_month BETWEEN ? AND ? AND s.calculated_at IS NOT NULL AND j.returned_at IS NOT NULL AND j.deduction IS NOT NULL AND (? IS NULL OR j.store_id COLLATE utf8mb4_0900_ai_ci=?)`,
    [tenant, from.slice(0,7), to.slice(0,7), store??null, store??null, tenant, from.slice(0,7), to.slice(0,7), store??null, store??null],
  );
  return rows as Array<{timestamp:string;amount:string;incomplete:number}>;
}
