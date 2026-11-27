import { mysqlConnectionLoader } from '../apps/worker/src/queue.js';
import { walmartGet } from '../packages/walmart-client/src/transport.js';
const c=await mysqlConnectionLoader({tenantId:'default',storeId:'prod-001',resource:'inventory',window:{from:'',to:''}});
for (const path of ['/v3/settings/shipping/shipnodes','/v3/fulfillment/inventory']) { const r=await walmartGet<any>(c,path,{query:{limit:'5',offset:'0'}}); console.log(path,JSON.stringify(r.data).slice(0,4000)); }
