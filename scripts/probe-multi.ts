import { mysqlConnectionLoader } from '../apps/worker/src/queue.js';
import { walmartGet } from '../packages/walmart-client/src/transport.js';
const c=await mysqlConnectionLoader({tenantId:'default',storeId:'prod-001',resource:'inventory',window:{from:'',to:''}});
const r=await walmartGet(c,'/v3/inventories',{query:{limit:'10',offset:'0'}}); console.log(JSON.stringify({status:r.status,body:r.data},null,2));
