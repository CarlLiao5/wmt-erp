import mysql from '../packages/db/node_modules/mysql2/promise.js';
import { normalizeReturnPayload } from '../apps/worker/src/jobs/syncReturns.js';

const tenantId = process.env.RETURN_BACKFILL_TENANT;
if (!tenantId) throw new Error('Set RETURN_BACKFILL_TENANT before running this script');
if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL is required');
const to = process.env.RETURN_BACKFILL_TO ?? new Date().toISOString().slice(0, 10);
const fromDate = new Date(`${process.env.RETURN_BACKFILL_FROM ?? to}T00:00:00.000Z`);
if (!process.env.RETURN_BACKFILL_FROM) fromDate.setUTCDate(fromDate.getUTCDate() - 29);
const from = fromDate.toISOString().slice(0, 10);
const pool = mysql.createPool({ uri: process.env.MYSQL_URL, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 1 });

try {
  const [rawRows] = await pool.query('SELECT store_id AS storeId, external_id AS rawResponseId, payload FROM raw_payloads WHERE tenant_id = ? AND resource = ? AND received_at >= ? AND received_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY received_at ASC', [tenantId, 'returns', from, to]) as [Array<{ storeId: string | null; rawResponseId: string; payload: unknown }>, unknown];
  const records = new Map<string, ReturnType<typeof normalizeReturnPayload>[number]>();
  for (const row of rawRows) {
    if (!row.storeId) continue;
    for (const record of normalizeReturnPayload(row.payload, { tenantId, storeId: row.storeId, rawResponseId: row.rawResponseId })) records.set(record.id, record);
  }
  const rows = [...records.values()];
  for (let offset = 0; offset < rows.length; offset += 300) {
    const batch = rows.slice(offset, offset + 300);
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const values = batch.flatMap((row) => [row.id, row.tenantId, row.storeId, row.orderId, row.orderNumber ?? null, row.itemId ?? null, row.sku, row.status, row.amount, row.reason ?? null, row.returnedAt]);
    await pool.query(`INSERT INTO return_records (id, tenant_id, store_id, order_id, order_number, item_id, sku, status, amount, reason, returned_at) VALUES ${placeholders} ON DUPLICATE KEY UPDATE order_id=VALUES(order_id), order_number=VALUES(order_number), item_id=VALUES(item_id), sku=VALUES(sku), status=VALUES(status), amount=VALUES(amount), reason=VALUES(reason), returned_at=VALUES(returned_at)`, values);
  }
  console.log(JSON.stringify({ from, to, rawPayloads: rawRows.length, returnRows: rows.length }));
} finally {
  await pool.end();
}
