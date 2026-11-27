import crypto from 'node:crypto';
import mysql from '../packages/db/node_modules/mysql2/promise.js';

const connectionString = process.env.MYSQL_URL ?? 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';

const tenantId = process.env.BRIGHTDATA_FIXTURE_TENANT ?? 'default';
const itemId = 'BRIGHTDATA-DAILY-TEST-001';
const productName = 'Bright Data 日库存测试商品';
const rows = [
  ['2026-10-18 09:00:00', 100],
  ['2026-10-18 18:00:00', 95],
  ['2026-10-19 09:00:00', 90],
  ['2026-10-19 18:00:00', 84],
  ['2026-10-20 09:00:00', 78],
];

const uuidFor = (value) => {
  const hex = crypto.createHash('sha256').update(`brightdata-fixture:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
};

const pool = mysql.createPool({ uri: connectionString, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 2 });
try {
  for (const [queriedAt, quantity] of rows) {
    const key = `fixture:daily-latest:${itemId}:${queriedAt}`;
    await pool.execute(`
      INSERT INTO brightdata_product_inventory
        (id, tenant_id, store_id, source_item_id, item_id, run_id, product_name,
         available_quantity, queried_at, price, description, rating, review_count,
         raw_payload, idempotency_key, created_at)
      VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        available_quantity = VALUES(available_quantity), queried_at = VALUES(queried_at),
        price = VALUES(price), rating = VALUES(rating), review_count = VALUES(review_count),
        raw_payload = VALUES(raw_payload)
    `, [
      uuidFor(key), tenantId, itemId, uuidFor('run:daily-latest'), productName,
      quantity, queriedAt, '19.99', '本地测试数据：同日多次抓取只取最后一次', '4.6', 128,
      JSON.stringify({ fixture: 'brightdata-daily-latest', itemId, queriedAt, quantity }), key, new Date(),
    ]);
  }
  console.log(JSON.stringify({ tenantId, itemId, insertedOrUpdated: rows.length, rows }, null, 2));
} finally {
  await pool.end();
}
