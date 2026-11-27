import {createHash} from 'node:crypto';
import {createDb} from '../packages/db/src/db.js';
import {createSyncQueue,enqueueSync,syncJobId,reportQueueNameForStore,mysqlConnectionLoader} from '../apps/worker/src/queue.js';

if(new URL(process.env.MYSQL_URL!).hostname.toLowerCase()!=='doke.synology.me')throw Error('Expected Doke');
const {pool}=createDb();
const execute=process.argv.includes('--enqueue');
const [stores]:any=await pool.query("SELECT s.id,s.name,s.tenant_id AS tenantId FROM stores s JOIN store_credentials c ON c.store_id=s.id AND c.tenant_id=s.tenant_id WHERE s.environment='production' ORDER BY s.id");
const groups=new Map<string,number>();
let queued=0,skipped=0;
const queues:ReturnType<typeof createSyncQueue>[]=[];
try{
 for(const store of stores){
  const connection=await mysqlConnectionLoader({tenantId:store.tenantId,storeId:store.id,resource:'inventory-recon',window:{from:'',to:''}});
  const credentialKey=createHash('sha256').update(connection.environment+':'+connection.clientId).digest('hex');
  const [runs]:any=await pool.query("SELECT report_month,status,request_id,batch_key,created_at FROM wfs_inventory_recon_runs WHERE tenant_id=? AND store_id=? ORDER BY created_at DESC",[store.tenantId,store.id]);
  console.log(JSON.stringify({store:store.name,storeId:store.id,existing:runs.map((r:any)=>({month:r.report_month,status:r.status,requestId:r.request_id}))}));
  if(!execute)continue;
  const q=createSyncQueue(undefined,reportQueueNameForStore(store.id));queues.push(q);
  // The live endpoint replenishes report creation hourly. Use 70 minutes between
  // requests sharing credentials, and honor any larger server cooldown in the client.
  const recent=runs.filter((r:any)=>r.request_id).reduce((n:number,r:any)=>Math.max(n,new Date(r.created_at).getTime()+70*60000),0);
  let slot=Math.max(Date.now(),groups.get(credentialKey)??0,recent);
  for(const month of ['2026-06','2026-07','2026-08','2026-09']){
   const prior=runs.find((r:any)=>r.report_month===month&&r.status==='completed');
   if(prior){skipped++;console.log(JSON.stringify({store:store.name,month,status:'already-completed'}));continue;}
   const pending=runs.find((r:any)=>r.report_month===month&&r.request_id&&r.status!=='completed');
   const batchId=pending?.batch_key??'backfill-recon-'+month+'-v1';
   const request={tenantId:store.tenantId,storeId:store.id,resource:'inventory-recon',batchId,window:{from:month+'-01T00:00:00.000Z',to:new Date(Date.UTC(2026,Number(month.slice(5,7)),1)-1).toISOString()}};
   const key=syncJobId(request);
   const existing=await q.queue.getJob(key);
   if(existing){
    const state=await existing.getState();
    if(state!=='failed'){skipped++;console.log(JSON.stringify({store:store.name,month,status:state,jobId:key}));continue;}
    await existing.remove();
   }
   const delay=pending?0:Math.max(0,slot-Date.now());
   const proxy={add:(name:any,data:any,options:any)=>q.queue.add(name,data,{...options,delay,attempts:3,backoff:{type:'fixed',delay:70*60000}})} as any;
   await enqueueSync(request,proxy);
   await pool.query("UPDATE sync_jobs SET available_at=?,result_payload=? WHERE tenant_id=? AND store_id=? AND idempotency_key=?",
    [new Date(Date.now()+delay),JSON.stringify({resource:'inventory-recon',phase:delay?'限速排队，等待申请':'准备申请报告',month}),store.tenantId,store.id,key]);
   const job=await q.queue.getJob(key);
   queued++;
   console.log(JSON.stringify({store:store.name,month,status:await job?.getState(),availableAt:new Date(Date.now()+delay).toISOString(),jobId:key}));
   if(!pending)slot+=70*60000;
  }
  groups.set(credentialKey,slot);
 }
 console.log(JSON.stringify({mode:execute?'enqueue':'inspect',stores:stores.length,credentialGroups:execute?groups.size:undefined,queued,skipped}));
}finally{await Promise.all(queues.map(async q=>{await q.queue.close();await q.redis.quit();}));}
process.exit(0);
