import mysql from '../packages/db/node_modules/mysql2/promise.js';
import { normalizeOrderPayload } from '../apps/worker/src/jobs/syncOrders.js';

const tenantId = process.env.ORDER_REGION_BACKFILL_TENANT;
if (!tenantId) throw new Error('Set ORDER_REGION_BACKFILL_TENANT before running this script');
if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL is required');

const to = process.env.ORDER_REGION_BACKFILL_TO ?? new Date().toISOString().slice(0, 10);
const fromDate = new Date(`${process.env.ORDER_REGION_BACKFILL_FROM ?? to}T00:00:00.000Z`);
if (!process.env.ORDER_REGION_BACKFILL_FROM) fromDate.setUTCDate(fromDate.getUTCDate() - 179);
const from = fromDate.toISOString().slice(0, 10);
const pool = mysql.createPool({ uri: process.env.MYSQL_URL, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 1 });

try {
  const connection = await pool.getConnection();
  try {
    await connection.query('CREATE TEMPORARY TABLE order_region_backfill (id varchar(191) NOT NULL PRIMARY KEY, region varchar(80) NOT NULL) ENGINE=MEMORY');
    const [rawRows] = await connection.query('SELECT store_id AS storeId, payload FROM raw_payloads WHERE tenant_id = ? AND resource = ? AND received_at >= ? AND received_at < DATE_ADD(?, INTERVAL 1 DAY)', [tenantId, 'orders', from, to]) as [Array<{ storeId: string | null; payload: unknown }>, unknown];
    const regions = new Map<string, string>();
    for (const row of rawRows) {
      if (!row.storeId) continue;
      for (const line of normalizeOrderPayload(row.payload, { tenantId, storeId: row.storeId, rawResponseId: '' })) {
        if (line.region) regions.set(line.orderId, line.region);
      }
    }
    const entries = [...regions];
    for (let offset = 0; offset < entries.length; offset += 500) {
      await connection.query('INSERT INTO order_region_backfill (id, region) VALUES ? ON DUPLICATE KEY UPDATE region = VALUES(region)', [entries.slice(offset, offset + 500)]);
    }
    const [result] = await connection.query('UPDATE orders o INNER JOIN order_region_backfill r ON r.id = o.id SET o.region = r.region WHERE o.tenant_id = ?', [tenantId]) as [mysql.ResultSetHeader, unknown];
    console.log(JSON.stringify({ from, to, parsedOrders: entries.length, updatedOrders: result.affectedRows }));
  } finally {
    connection.release();
  }
} finally {
  await pool.end();
}
