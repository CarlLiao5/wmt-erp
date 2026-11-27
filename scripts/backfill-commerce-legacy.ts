import crypto from 'node:crypto';
import mysql from '../packages/db/node_modules/mysql2/promise.js';

type LegacyStore = { sourceName: string; storeId: string };
type LegacyOrder = Record<string, unknown> & { store_name: string; purchase_order_id: string };
type LegacyItem = Record<string, unknown> & { store_name: string; purchase_order_id: string; line_number: string };
type LegacyReturn = Record<string, unknown> & { store_name: string; return_order_id: string };
export type LegacyMappingAnomaly = { kind: 'unknown_store' | 'missing_parent_order' | 'missing_sku'; storeName?: string; purchaseOrderId?: string; returnOrderId?: string; rowId?: string | number };
export type LegacyPlan = { stores: LegacyStore[]; orders: LegacyOrder[]; items: LegacyItem[]; returns: LegacyReturn[]; anomalies: LegacyMappingAnomaly[]; counts: { orders: number; items: number; returns: number; missingParentItems: number; missingSkuReturns: number } };

export const STORE_ALIASES: Record<string, string> = {
  '亿辰沃尔玛': 'prod-001',
  '兴隆德沃尔玛': '10001578336',
  '厦门多壳沃尔玛': '10001133528',
  '禹铮沃尔玛': '10001156838',
  '鑫起典沃尔玛': '10002512034',
  '鑫启典沃尔玛': '10002512034',
};

function stableId(...parts: unknown[]) { return crypto.createHash('sha256').update(parts.map((value) => String(value ?? '')).join('\u001f')).digest('hex').slice(0, 36); }
function storeIdFor(name: unknown) { return STORE_ALIASES[String(name ?? '').trim()]; }
export function canonicalStoreName(storeId: string, stores: Array<{ id: string; name: string }>) {
  return stores.find((store) => store.id === storeId)?.name;
}
export function mapLegacyItemOnlyOrder(input: { storeId: string; tenantId: string; storeName: string; purchaseOrderId: string }) {
  return { id: `${input.storeId}:${input.purchaseOrderId}`, tenantId: input.tenantId, storeId: input.storeId, externalId: input.purchaseOrderId, status: 'LEGACY_PARTIAL', orderedAt: null, totalAmount: '0', currency: 'USD', storeName: input.storeName, sourceApi: 'legacy_item_only' };
}
export function planLegacyCommerceRows(input: { stores: Array<{ id: string; name: string }>; orders: LegacyOrder[]; items: LegacyItem[]; returns: LegacyReturn[] }): LegacyPlan {
  const known = new Map(input.stores.map((store) => [store.id, store]));
  const anomalies: LegacyMappingAnomaly[] = [];
  const orders = input.orders.filter((row) => { const id = storeIdFor(row.store_name); if (!id || !known.has(id)) { anomalies.push({ kind: 'unknown_store', storeName: row.store_name, rowId: row.id }); return false; } return true; }).map((row) => ({ ...row, store_name: known.get(storeIdFor(row.store_name)!)!.name }));
  const orderKeys = new Set(orders.map((row) => `${storeIdFor(row.store_name)}\u001f${row.purchase_order_id}`));
  const items = input.items.filter((row) => { const storeId = storeIdFor(row.store_name); if (!storeId || !known.has(storeId)) { anomalies.push({ kind: 'unknown_store', storeName: row.store_name, purchaseOrderId: row.purchase_order_id, rowId: row.id }); return false; } if (!orderKeys.has(`${storeId}\u001f${row.purchase_order_id}`)) anomalies.push({ kind: 'missing_parent_order', storeName: row.store_name, purchaseOrderId: row.purchase_order_id, rowId: row.id }); return true; }).map((row) => ({ ...row, store_name: known.get(storeIdFor(row.store_name)!)!.name }));
  const returns = input.returns.filter((row) => { const storeId = storeIdFor(row.store_name); if (!storeId || !known.has(storeId)) { anomalies.push({ kind: 'unknown_store', storeName: row.store_name, returnOrderId: row.return_order_id, rowId: row.id }); return false; } if (!row.sku) anomalies.push({ kind: 'missing_sku', storeName: row.store_name, returnOrderId: row.return_order_id, rowId: row.id }); return true; }).map((row) => ({ ...row, store_name: known.get(storeIdFor(row.store_name)!)!.name }));
  return { stores: [...known.values()].filter((store) => Object.values(STORE_ALIASES).includes(store.id)), orders, items, returns, anomalies, counts: { orders: orders.length, items: items.length, returns: returns.length, missingParentItems: anomalies.filter((row) => row.kind === 'missing_parent_order').length, missingSkuReturns: anomalies.filter((row) => row.kind === 'missing_sku').length } };
}

function value(input: unknown) { return input == null || input === '' ? null : input; }
export function isRetryableMysqlConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(String(error.code));
}
async function run() {
  const apply = process.argv.includes('--apply');
  const url = process.env.MYSQL_URL;
  if (!url) throw new Error('MYSQL_URL is required');
  const pool = mysql.createPool({ uri: url, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 2 });
  let conn = await pool.getConnection();
  try {
    const [stores] = await conn.query('SELECT id, name FROM stores WHERE tenant_id = ?', ['default']) as [Array<{ id: string; name: string }>, unknown];
    if (!apply) {
      const [orderCount] = await conn.query('SELECT COUNT(*) AS count FROM `orders old`') as [Array<{ count: number }>, unknown];
      const [itemCount] = await conn.query('SELECT COUNT(*) AS count FROM order_items') as [Array<{ count: number }>, unknown];
      const [returnCount] = await conn.query('SELECT COUNT(*) AS count FROM returns') as [Array<{ count: number }>, unknown];
      const [orphans] = await conn.query("SELECT COUNT(*) AS count FROM order_items i LEFT JOIN `orders old` o ON o.purchase_order_id COLLATE utf8mb4_0900_ai_ci=i.purchase_order_id COLLATE utf8mb4_0900_ai_ci AND o.store_name COLLATE utf8mb4_0900_ai_ci=i.store_name COLLATE utf8mb4_0900_ai_ci WHERE o.id IS NULL") as [Array<{ count: number }>, unknown];
      const [missingSku] = await conn.query("SELECT COUNT(*) AS count FROM returns WHERE sku IS NULL OR sku = ''") as [Array<{ count: number }>, unknown];
      const [orderNameMismatches] = await conn.query(`SELECT o.store_name AS stored_name, s.name AS canonical_name, COUNT(*) AS count FROM orders o JOIN stores s ON s.id COLLATE utf8mb4_0900_ai_ci = o.store_id COLLATE utf8mb4_0900_ai_ci WHERE o.tenant_id = ? AND o.store_id = ? AND COALESCE(o.store_name, '') COLLATE utf8mb4_0900_ai_ci <> s.name COLLATE utf8mb4_0900_ai_ci GROUP BY o.store_name, s.name`, ['default', '10002512034']) as [Array<{ stored_name: string | null; canonical_name: string; count: number }>, unknown];
      const [returnNameMismatches] = await conn.query(`SELECT r.store_name AS stored_name, s.name AS canonical_name, COUNT(*) AS count FROM return_records r JOIN stores s ON s.id COLLATE utf8mb4_0900_ai_ci = r.store_id COLLATE utf8mb4_0900_ai_ci WHERE r.tenant_id = ? AND r.store_id = ? AND COALESCE(r.store_name, '') COLLATE utf8mb4_0900_ai_ci <> s.name COLLATE utf8mb4_0900_ai_ci GROUP BY r.store_name, s.name`, ['default', '10002512034']) as [Array<{ stored_name: string | null; canonical_name: string; count: number }>, unknown];
      const [orderCollisions] = await conn.query(`SELECT o.source_api, COUNT(DISTINCT CONCAT(s.id, ':', l.purchase_order_id)) AS matched_keys FROM \`orders old\` l JOIN stores s ON s.id COLLATE utf8mb4_0900_ai_ci = CASE WHEN l.store_name = '亿辰沃尔玛' THEN 'prod-001' WHEN l.store_name = '兴隆德沃尔玛' THEN '10001578336' WHEN l.store_name = '厦门多壳沃尔玛' THEN '10001133528' WHEN l.store_name = '禹铮沃尔玛' THEN '10001156838' WHEN l.store_name = '鑫起典沃尔玛' OR l.store_name = '鑫启典沃尔玛' THEN '10002512034' ELSE '' END COLLATE utf8mb4_0900_ai_ci JOIN orders o ON o.store_id COLLATE utf8mb4_0900_ai_ci = s.id COLLATE utf8mb4_0900_ai_ci AND o.external_id COLLATE utf8mb4_0900_ai_ci = l.purchase_order_id COLLATE utf8mb4_0900_ai_ci GROUP BY o.source_api`) as [Array<{ source_api: string | null; matched_keys: number }>, unknown];
      console.log(JSON.stringify({ mode: 'dry-run-summary', counts: { orders: Number(orderCount[0].count), items: Number(itemCount[0].count), returns: Number(returnCount[0].count), missingParentItems: Number(orphans[0].count), missingSkuReturns: Number(missingSku[0].count) }, standardStoreNameMismatches: [...orderNameMismatches.map((row) => ({ table: 'orders', ...row, count: Number(row.count) })), ...returnNameMismatches.map((row) => ({ table: 'return_records', ...row, count: Number(row.count) }))], existingStandardOrderKeyCollisions: orderCollisions.map((row) => ({ sourceApi: row.source_api, keys: Number(row.matched_keys) })), storeAliases: STORE_ALIASES }, null, 2));
      return;
    }
    const knownStoreIds = new Set(stores.map((store) => store.id));
    const storeNameById = new Map(stores.map((store) => [store.id, canonicalStoreName(store.id, stores)!]));
    const totals = { orders: 0, items: 0, returns: 0, missingParentItems: 0, missingSkuReturns: 0 };
    const batchSize = Math.max(50, Math.min(1000, Number(process.env.COMMERCE_BACKFILL_BATCH_SIZE ?? 250)));
    const now = new Date();
    const scan = async <T extends { id: number }>(table: string, consume: (connection: Awaited<ReturnType<typeof pool.getConnection>>, rows: T[]) => Promise<void>) => {
      let cursor = 0;
      while (true) {
        let rowsForLog: T[] = [];
        let committed = false;
        for (let attempt = 0; attempt < 4 && !committed; attempt += 1) {
          const batchConn = await pool.getConnection();
          try {
            const [rows] = await batchConn.query(`SELECT * FROM \`${table}\` WHERE id > ? ORDER BY id LIMIT ?`, [cursor, batchSize]) as [T[], unknown];
            if (!rows.length) return;
            rowsForLog = rows;
            await batchConn.beginTransaction();
            await consume(batchConn, rows);
            await batchConn.commit();
            cursor = Number(rows.at(-1)!.id);
            committed = true;
          } catch (error) {
            try { await batchConn.rollback(); } catch { /* A dead connection may have rolled back already. */ }
            if (!isRetryableMysqlConnectionError(error) || attempt === 3) throw error;
          } finally {
            batchConn.release();
          }
        }
        if (!committed) throw new Error(`Could not commit ${table} batch after reconnect retries`);
        if (table === 'orders old') totals.orders += rowsForLog.length;
        if (table === 'order_items') totals.items += rowsForLog.length;
        if (table === 'returns') {
          totals.returns += rowsForLog.length;
          totals.missingSkuReturns += rowsForLog.filter((row) => !row.sku).length;
        }
        if (cursor % 10000 < batchSize) process.stdout.write(`${table}: ${cursor}\n`);
      }
    };
    await scan<LegacyOrder>('orders old', async (batchConn, rows) => {
      const values = rows.map((row) => { const storeId = storeIdFor(row.store_name); if (!storeId || !knownStoreIds.has(storeId)) throw new Error(`Unknown legacy order store: ${row.store_name}`); return [`${storeId}:${row.purchase_order_id}`,'default',storeId,row.purchase_order_id,value(row.customer_order_id),value(row.customer_email),value(row.order_status) ?? 'UNKNOWN',value(row.state),value(row.state),value(row.postal_code),value(row.city),value(row.country),value(row.order_date),value(row.estimated_delivery_date),value(row.total_amount) ?? 0,value(row.currency) ?? 'USD',value(row.fulfillment_option),value(row.ship_method),value(row.is_wfs) ?? 0,storeNameById.get(storeId)!,'legacy_import',row.updated_at ?? now]; });
      await batchConn.query(`INSERT INTO orders (id,tenant_id,store_id,external_id,customer_order_id,customer_email,status,state,region,postal_code,city,country,ordered_at,estimated_delivery_at,total_amount,currency,fulfillment_option,ship_method,is_wfs,store_name,source_api,updated_at) VALUES ? ON DUPLICATE KEY UPDATE customer_order_id=IF(source_api='legacy_import',COALESCE(VALUES(customer_order_id),customer_order_id),COALESCE(customer_order_id,VALUES(customer_order_id))),customer_email=IF(source_api='legacy_import',COALESCE(VALUES(customer_email),customer_email),COALESCE(customer_email,VALUES(customer_email))),status=IF(source_api='legacy_import',VALUES(status),COALESCE(status,VALUES(status))),state=IF(source_api='legacy_import',COALESCE(VALUES(state),state),COALESCE(state,VALUES(state))),region=IF(source_api='legacy_import',COALESCE(VALUES(region),region),COALESCE(region,VALUES(region))),postal_code=IF(source_api='legacy_import',COALESCE(VALUES(postal_code),postal_code),COALESCE(postal_code,VALUES(postal_code))),city=IF(source_api='legacy_import',COALESCE(VALUES(city),city),COALESCE(city,VALUES(city))),country=IF(source_api='legacy_import',COALESCE(VALUES(country),country),COALESCE(country,VALUES(country))),ordered_at=IF(source_api='legacy_import',COALESCE(VALUES(ordered_at),ordered_at),COALESCE(ordered_at,VALUES(ordered_at))),estimated_delivery_at=IF(source_api='legacy_import',COALESCE(VALUES(estimated_delivery_at),estimated_delivery_at),COALESCE(estimated_delivery_at,VALUES(estimated_delivery_at))),total_amount=IF(source_api='legacy_import',VALUES(total_amount),COALESCE(total_amount,VALUES(total_amount))),currency=IF(source_api='legacy_import',VALUES(currency),COALESCE(currency,VALUES(currency))),fulfillment_option=IF(source_api='legacy_import',COALESCE(VALUES(fulfillment_option),fulfillment_option),COALESCE(fulfillment_option,VALUES(fulfillment_option))),ship_method=IF(source_api='legacy_import',COALESCE(VALUES(ship_method),ship_method),COALESCE(ship_method,VALUES(ship_method))),is_wfs=IF(source_api='legacy_import',COALESCE(VALUES(is_wfs),is_wfs),COALESCE(is_wfs,VALUES(is_wfs))),store_name=COALESCE(VALUES(store_name),store_name),updated_at=IF(source_api='legacy_import',GREATEST(updated_at,VALUES(updated_at)),updated_at)`, [values]);
    });
    await scan<LegacyItem>('order_items', async (batchConn, rows) => {
      const parentValues = [...new Map(rows.map((row) => {
        const storeId = storeIdFor(row.store_name);
        if (!storeId || !knownStoreIds.has(storeId)) throw new Error(`Unknown legacy item store: ${row.store_name}`);
        const id = `${storeId}:${row.purchase_order_id}`;
        return [id, [id, 'default', storeId, row.purchase_order_id, 'LEGACY_PARTIAL', null, 0, 'USD', storeNameById.get(storeId)!, 'legacy_item_only', row.updated_at ?? now]] as const;
      })).values()];
      await batchConn.query(`INSERT IGNORE INTO orders (id,tenant_id,store_id,external_id,status,ordered_at,total_amount,currency,store_name,source_api,updated_at) VALUES ?`, [parentValues]);
      const skuValues = rows.map((row) => { const storeId = storeIdFor(row.store_name); if (!storeId || !knownStoreIds.has(storeId)) throw new Error(`Unknown legacy item store: ${row.store_name}`); const sku = String(row.sku ?? `legacy-missing-${row.id}`); return [`${storeId}:${sku}`,'default',storeId,sku,value(row.product_id),value(row.product_name),row.created_at ?? now,row.updated_at ?? now]; });
      await batchConn.query(`INSERT INTO skus (id,tenant_id,store_id,external_id,item_id,title,created_at,updated_at) VALUES ? ON DUPLICATE KEY UPDATE item_id=COALESCE(VALUES(item_id),item_id),title=COALESCE(VALUES(title),title),updated_at=VALUES(updated_at)`, [skuValues]);
      const values = rows.map((row) => { const storeId = storeIdFor(row.store_name)!; const sku = String(row.sku ?? `legacy-missing-${row.id}`); return [`${storeId}:${row.purchase_order_id}:${row.line_number}`,'default',storeId,`${storeId}:${row.purchase_order_id}`,`${storeId}:${sku}`,value(row.line_number),value(row.upc),value(row.product_id),value(row.product_name),value(row.quantity) ?? 0,value(row.unit_price),value(row.unit_price) ?? 0,value(row.shipping_charge),value(row.currency) ?? 'USD',value(row.item_status),value(row.created_at),value(row.updated_at)]; });
      await batchConn.query(`INSERT IGNORE INTO order_lines (id,tenant_id,store_id,order_id,sku_id,line_number,upc,product_id,product_name,quantity,unit_price,line_amount,shipping_charge,currency,item_status,created_at,updated_at) VALUES ?`, [values]);
    });
    await scan<LegacyReturn>('returns', async (batchConn, rows) => {
      const values = rows.map((row) => { const storeId = storeIdFor(row.store_name); if (!storeId || !knownStoreIds.has(storeId)) throw new Error(`Unknown legacy return store: ${row.store_name}`); return [`${storeId}:${row.return_order_id}:${row.return_order_item_id ?? row.id}`,'default',storeId,value(row.return_order_id),value(row.purchase_order_id) ? `${storeId}:${row.purchase_order_id}` : `${storeId}:${row.return_order_id}`,value(row.purchase_order_id),value(row.customer_order_id),value(row.return_order_item_id),value(row.product_id),value(row.sku),value(row.product_name),value(row.quantity),value(row.return_status) ?? 'UNKNOWN',value(row.refund_amount) ?? 0,value(row.currency) ?? 'USD',value(row.return_reason),value(row.return_reason_code),row.return_initiated_date ?? row.created_at ?? now,value(row.return_initiated_date),value(row.refund_issued_date),value(row.is_wfs) ?? 0,storeNameById.get(storeId)!,value(row.return_method),value(row.delivery_status),value(row.channel_name),value(row.refund_status),value(row.created_at),value(row.updated_at) ?? now]; });
      await batchConn.query(`INSERT IGNORE INTO return_records (id,tenant_id,store_id,return_order_id,order_id,order_number,customer_order_id,return_order_item_id,item_id,sku,product_name,quantity,status,amount,currency,reason,reason_code,returned_at,return_initiated_at,refund_issued_at,is_wfs,store_name,return_method,delivery_status,channel_name,refund_status,created_at,updated_at) VALUES ?`, [values]);
      const events = rows.map((row) => { const storeId = storeIdFor(row.store_name)!; const returnId = `${storeId}:${row.return_order_id}:${row.return_order_item_id ?? row.id}`; const sourceIdentity = `legacy:${row.id}`; return [stableId(storeId, sourceIdentity), 'default', storeId, returnId, sourceIdentity, String(row.return_status ?? 'UNKNOWN'), row.refund_amount == null ? null : String(row.refund_amount), value(row.return_initiated_date) ? row.return_initiated_date : null, null, row.updated_at ?? row.created_at ?? now]; });
      await batchConn.query(`INSERT IGNORE INTO return_status_events (id,tenant_id,store_id,return_id,source_identity,status,refund_amount,returned_at,raw_response_id,recorded_at) VALUES ?`, [events]);
    });
    conn.release();
    conn = await pool.getConnection();
    const [normalizedOrders] = await conn.query("UPDATE orders o JOIN stores s ON s.id COLLATE utf8mb4_0900_ai_ci = o.store_id COLLATE utf8mb4_0900_ai_ci SET o.store_name = s.name WHERE o.tenant_id = ? AND COALESCE(o.store_name, '') COLLATE utf8mb4_0900_ai_ci <> s.name COLLATE utf8mb4_0900_ai_ci", ['default']) as [{ affectedRows: number }, unknown];
    const [normalizedReturns] = await conn.query("UPDATE return_records r JOIN stores s ON s.id COLLATE utf8mb4_0900_ai_ci = r.store_id COLLATE utf8mb4_0900_ai_ci SET r.store_name = s.name WHERE r.tenant_id = ? AND COALESCE(r.store_name, '') COLLATE utf8mb4_0900_ai_ci <> s.name COLLATE utf8mb4_0900_ai_ci", ['default']) as [{ affectedRows: number }, unknown];
    const [orphanCount] = await conn.query("SELECT COUNT(*) AS count FROM order_items i LEFT JOIN `orders old` o ON o.purchase_order_id COLLATE utf8mb4_0900_ai_ci=i.purchase_order_id COLLATE utf8mb4_0900_ai_ci AND o.store_name COLLATE utf8mb4_0900_ai_ci=i.store_name COLLATE utf8mb4_0900_ai_ci WHERE o.id IS NULL") as [Array<{ count: number }>, unknown]; totals.missingParentItems = Number(orphanCount[0].count);
    console.log(JSON.stringify({ mode: 'apply', counts: totals, normalizedStoreNames: { orders: normalizedOrders.affectedRows, returns: normalizedReturns.affectedRows }, missingParentItems: 'preserved as order lines; parent date remains null', idempotent: true }, null, 2));
  } finally { try { conn.release(); } catch { /* Connection may already be closed. */ } await pool.end(); }
}
if (import.meta.url === `file://${process.argv[1]}`) run().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
