import crypto from 'node:crypto';
import { mysqlConnectionLoader } from '../apps/worker/src/queue.ts';
import { walmartGet } from '../packages/walmart-client/src/transport.ts';
import { getAccessToken } from '../packages/walmart-client/src/auth/token.ts';
import { createDb, and, eq, rawPayloads } from '../packages/db/index.ts';
process.env.MYSQL_URL ??= 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';
const connection = await mysqlConnectionLoader({ tenantId: 'default', storeId: '10001578336', resource: 'inventory', window: { from: '', to: '' } });
const { db, pool } = createDb();
const [item] = await db.select({ payload: rawPayloads.payload }).from(rawPayloads).where(and(eq(rawPayloads.storeId, '10001578336'), eq(rawPayloads.resource, 'wfs_inventory_health'))).limit(1);
await pool.end();
const payload = item?.payload ?? {};
const gtin = '00717067767127';
for (const path of ['/v3/fulfillment/inventory-log', '/v3/report/wfs/inventoryReconciliationReport']) {
  try {
    const response = await walmartGet(connection, path, { query: path.includes('inventory-log') ? { gtin, offset: '0', limit: '50' } : {} });
    console.log(JSON.stringify({ path, status: response.status, correlationId: response.correlationId, data: response.data }, null, 2));
  } catch (error) {
    const token = await getAccessToken(connection);
    const url = new URL(path, connection.baseUrl); if (path.includes('inventory-log')) { url.searchParams.set('gtin', gtin); url.searchParams.set('offset', '0'); url.searchParams.set('limit', '50'); }
    const response = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}`, 'WM_SEC.ACCESS_TOKEN': token.accessToken, 'WM_QOS.CORRELATION_ID': crypto.randomUUID(), 'WM_SVC.NAME': 'Walmart Marketplace', 'WM_MARKET': 'us', 'WM_GLOBAL_VERSION': '3.1' } });
    console.log(JSON.stringify({ path, status: response.status, body: await response.text() }, null, 2));
  }
}
