import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {createDb} from '../packages/db/src/db.js';
import {createSyncQueue,enqueueSync,reportQueueNameForStore,syncQueueNameForResource} from '../apps/worker/src/queue.js';
const {pool}=createDb(),storeId=process.env.TEST_STORE_ID??'10001133528',tenantId='default';
const [plans]:any=await pool.query("SELECT id,resource,overlap_days FROM sync_plans WHERE tenant_id=? AND store_id=? AND mode='incremental' AND resource IN ('orders','inventory','item-report')",[tenantId,storeId]);
const runs:any[]=[];
for(const resource of ['orders','inventory','item-report']){const plan=plans.find((p:any)=>p.resource===resource);if(!plan)throw Error(`Missing incremental plan ${resource}`);const now=new Date(),from=new Date(now.getTime()-(plan.overlap_days||5)*86400000),windowId=randomUUID(),batchId=`normalization-test:${randomUUID()}`;
 await pool.query("INSERT INTO sync_windows (id,plan_id,tenant_id,store_id,resource,batch_id,window_from,window_to,status,request_params,`cursor`,page_count,record_count,attempts,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'planned',?,NULL,0,0,0,'walmart_api',?,?)",[windowId,plan.id,tenantId,storeId,resource,batchId,from,now,JSON.stringify({validation:'standardized-incremental'}),now,now]);
 const request={tenantId,storeId,resource,window:{from:from.toISOString(),to:now.toISOString()},batchId,syncWindowId:windowId,...resource==='inventory'?{state:{shipmentMode:'incremental'}}:{}};
 const {queue,redis}=createSyncQueue(undefined,resource==='item-report'?reportQueueNameForStore(storeId):syncQueueNameForResource(resource));
 try{const job=await enqueueSync(request,queue);runs.push({resource,windowId,jobId:job.jobId,startedAt:now.toISOString()});}finally{await queue.close();await redis.quit();}
}
fs.writeFileSync('/tmp/wmterp-standardized-incremental-runs.json',JSON.stringify(runs));console.log(JSON.stringify(runs));process.exit(0);
