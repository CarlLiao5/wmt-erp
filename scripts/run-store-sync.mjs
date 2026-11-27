import crypto from 'node:crypto';
import { mysqlConnectionLoader } from '../apps/worker/src/queue.ts';
import { syncWfsToDatabase } from '../apps/worker/src/jobs/syncWfs.ts';
process.env.MYSQL_URL ??= 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';
const storeId = process.argv[2];
const connection = await mysqlConnectionLoader({ tenantId: 'default', storeId, resource: 'inventory', window: { from: '', to: '' } });
console.log(await syncWfsToDatabase({ tenantId: 'default', storeId, from: '', to: '', batchId: crypto.randomUUID() }, connection));
