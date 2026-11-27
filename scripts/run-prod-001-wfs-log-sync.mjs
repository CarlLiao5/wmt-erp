import crypto from 'node:crypto';
import { mysqlConnectionLoader } from '../apps/worker/src/queue.ts';
import { syncWfsToDatabase } from '../apps/worker/src/jobs/syncWfs.ts';
process.env.MYSQL_URL ??= 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp';
const connection = await mysqlConnectionLoader({ tenantId: 'default', storeId: 'prod-001', resource: 'inventory', window: { from: '', to: '' } });
console.log(await syncWfsToDatabase({ tenantId: 'default', storeId: 'prod-001', from: '', to: '', batchId: crypto.randomUUID() }, connection));
