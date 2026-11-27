import mysql from '../packages/db/node_modules/mysql2/promise.js';

type SalesDay = { day: string; orders: string | number; units: string | number; revenue: string | number };
type RefundDay = { day: string; refunds: string | number };
type DailyFactInsert = [string, string, string, string, string, string | number, string | null];

export function buildCommerceDailyFacts(input: {
  tenantId: string;
  storeId: string;
  sales: SalesDay[];
  refunds: RefundDay[];
}): DailyFactInsert[] {
  const refundsByDay = new Map(input.refunds.map((row) => [row.day, row.refunds]));
  const salesDays = new Set(input.sales.map((row) => row.day));
  const facts: DailyFactInsert[] = input.sales.flatMap((row) => ['revenue', 'orders', 'units', 'refunds'].map((metric) => [
    `${input.storeId}:${row.day}:${metric}`, input.tenantId, input.storeId, row.day, metric,
    metric === 'refunds' ? refundsByDay.get(row.day) ?? '0' : row[metric as 'revenue' | 'orders' | 'units'],
    metric === 'revenue' || metric === 'refunds' ? 'USD' : null,
  ] as DailyFactInsert));
  for (const row of input.refunds) {
    if (!salesDays.has(row.day)) facts.push([
      `${input.storeId}:${row.day}:refunds`, input.tenantId, input.storeId, row.day, 'refunds', row.refunds, 'USD',
    ]);
  }
  return facts;
}

// Rebuild only commerce metrics; profit and other independently owned facts stay intact.
async function run() {
  if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL is required');
  const apply = process.argv.includes('--apply');
  const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice(9) ?? 'default';
  const pool = mysql.createPool({ uri: process.env.MYSQL_URL, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 2 });
  try {
    const [zone] = await pool.query("SELECT CONVERT_TZ('2026-11-03 08:00:00', '+00:00', 'America/Los_Angeles') AS value") as [Array<{ value: unknown }>, unknown];
    if (!zone[0]?.value) throw new Error('MySQL America/Los_Angeles timezone tables are required');
    const [stores] = await pool.query('SELECT id FROM stores WHERE tenant_id = ?', [tenantId]) as [Array<{ id: string }>, unknown];
    for (const store of stores) {
      const [sales] = await pool.query(`SELECT DATE_FORMAT(CONVERT_TZ(o.ordered_at, '+00:00', 'America/Los_Angeles'), '%Y-%m-%d') AS day,
        COUNT(DISTINCT o.id) AS orders, SUM(ol.quantity) AS units, SUM(ol.line_amount) AS revenue
        FROM orders o JOIN order_lines ol ON ol.order_id=o.id AND ol.tenant_id=o.tenant_id AND ol.store_id=o.store_id
        WHERE o.tenant_id=? AND o.store_id=? AND o.ordered_at IS NOT NULL AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED') GROUP BY day`, [tenantId, store.id]) as [Array<{ day: string; orders: string; units: string; revenue: string }>, unknown];
      const [refunds] = await pool.query(`SELECT DATE_FORMAT(CONVERT_TZ(o.ordered_at, '+00:00', 'America/Los_Angeles'), '%Y-%m-%d') AS day, SUM(r.amount) AS refunds
        FROM return_records r JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci = r.order_id AND o.tenant_id COLLATE utf8mb4_unicode_ci = r.tenant_id AND o.store_id COLLATE utf8mb4_unicode_ci = r.store_id
        WHERE r.tenant_id=? AND r.store_id=? AND UPPER(r.status)='REFUNDED' AND o.ordered_at IS NOT NULL AND UPPER(TRIM(o.status)) NOT IN ('CANCELLED','CANCELED')
        AND EXISTS (SELECT 1 FROM order_lines ol JOIN skus s ON s.id=ol.sku_id WHERE ol.order_id=o.id AND ol.tenant_id=o.tenant_id AND s.external_id COLLATE utf8mb4_0900_ai_ci = r.sku COLLATE utf8mb4_0900_ai_ci)
        GROUP BY day`, [tenantId, store.id]) as [Array<{ day: string; refunds: string }>, unknown];
      const values = buildCommerceDailyFacts({ tenantId, storeId: store.id, sales, refunds });
      if (apply) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query("DELETE FROM daily_facts WHERE tenant_id=? AND store_id=? AND metric IN ('revenue','orders','units','refunds')", [tenantId, store.id]);
          for (let start = 0; start < values.length; start += 500) await conn.query('INSERT INTO daily_facts (id,tenant_id,store_id,fact_date,metric,value,currency) VALUES ?', [values.slice(start, start + 500)]);
          await conn.commit();
        } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      }
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', storeId: store.id, days: sales.length, facts: values.length }));
    }
  } finally { await pool.end(); }
}
if (process.argv.some((arg) => arg.endsWith('rebuild-commerce-daily-facts.ts'))) run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
