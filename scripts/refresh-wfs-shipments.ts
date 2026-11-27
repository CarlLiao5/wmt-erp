import { and, createDb, eq, stores } from '../packages/db/index.js';
import { mysqlConnectionLoader } from '../apps/worker/src/queue.js';
import { syncWfsShipmentsToDatabase } from '../apps/worker/src/jobs/syncWfs.js';

const tenantId = process.env.TENANT_ID ?? 'default';
const { db, pool } = createDb();
let storeRows: Array<{ id: string; name: string; marketplace: string; environment: string }>;
try {
  storeRows = await db.select({ id: stores.id, name: stores.name, marketplace: stores.marketplace, environment: stores.environment })
    .from(stores)
    .where(and(eq(stores.tenantId, tenantId), eq(stores.marketplace, 'walmart')));
} finally {
  await pool.end();
}

const results: Array<{ store: string; environment: string; shipments?: number; error?: string }> = [];
for (const store of storeRows) {
  try {
    const request = { tenantId, storeId: store.id, resource: 'inventory', window: { from: '2000-01-01', to: new Date().toISOString().slice(0, 10) } };
    const connection = await mysqlConnectionLoader(request);
    const result = await syncWfsShipmentsToDatabase({ tenantId, storeId: store.id }, connection);
    results.push({ store: store.name, environment: store.environment, shipments: result.shipments });
    console.log(`${store.environment}\t${store.name}\t${result.shipments} shipments`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ store: store.name, environment: store.environment, error: message });
    console.error(`${store.environment}\t${store.name}\tFAILED\t${message}`);
  }
}

const failed = results.filter((result) => result.error);
console.log(`TOTAL\t${results.length - failed.length}/${results.length} stores\t${results.reduce((sum, result) => sum + (result.shipments ?? 0), 0)} shipments`);
if (failed.length) process.exitCode = 1;
