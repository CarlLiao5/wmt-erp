process.env.MYSQL_URL ??= 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';
import { createDb, rawPayloads, skus } from '../packages/db/index.ts';
const { db, pool } = createDb();
const rows = await db.select({ id: skus.id, storeId: skus.storeId, sku: skus.externalId, itemId: skus.itemId }).from(skus);
const raws = await db.select({ resource: rawPayloads.resource, storeId: rawPayloads.storeId, payload: rawPayloads.payload }).from(rawPayloads);
const latest = new Map();
for (const r of raws) {
  if (r.resource !== 'wfs_inventory_health') continue;
  const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
  const sku = String(p?.itemInformation?.sku ?? '').trim();
  const itemId = String(p?.itemInformation?.itemID ?? p?.itemInformation?.itemId ?? '').trim();
  if (sku && itemId) latest.set(`${r.storeId}:${sku}`, itemId);
}
let repaired = 0; const sample = [];
for (const row of rows) {
  const itemId = latest.get(`${row.storeId}:${row.sku}`);
  if (!itemId) continue;
  await db.update(skus).set({ itemId, updatedAt: new Date() }).where((await import('../packages/db/node_modules/drizzle-orm/index.js')).eq(skus.id, row.id));
  repaired++;
  if (sample.length < 8) sample.push({ storeId: row.storeId, sku: row.sku, from: row.itemId, to: itemId });
}
console.log(JSON.stringify({ healthMappings: latest.size, repaired, sample }));
await pool.end();
