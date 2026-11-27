import {readFile} from 'node:fs/promises';
import {createDb} from '../packages/db/src/db.js';
import {idFor} from '../packages/db/src/normalization/common.js';
import {createSyncWorker,enqueueSync,syncJobId} from '../apps/worker/src/queue.js';
import {nextScheduledRunAt} from '../packages/domain/src/syncPolicies.js';
if(new URL(process.env.MYSQL_URL!).hostname.toLowerCase()!=='doke.synology.me')throw Error('Expected Doke');
const {pool}=createDb();
if(process.argv.includes('--setup')){
 const sql=await readFile('packages/db/migrations/0065_inventory_reconciliation.sql','utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);
 console.log('Inventory reconciliation tables ready');
 const now=new Date();
 const [result]:any=await pool.query("INSERT IGNORE INTO sync_plans (id,tenant_id,store_id,resource,mode,status,interval_minutes,overlap_days,next_run_at,enabled,created_at,updated_at) SELECT UUID(),s.tenant_id,s.id,'inventory-recon','incremental','planned',43200,31,?,1,?,? FROM stores s JOIN store_credentials c ON c.tenant_id=s.tenant_id AND c.store_id=s.id WHERE s.environment='production'",[nextScheduledRunAt('inventory-recon',now),now,now]);
 console.log('Created monthly plans',result.affectedRows);
 process.exit(0);
}
const saved=JSON.parse(await readFile('artifacts/inventory-recon-validation/request.json','utf8'));
const window={from:'2026-10-01T00:00:00.000Z',to:'2026-10-31T23:59:59.999Z'};
const request={tenantId:saved.store.tenantId,storeId:saved.store.id,resource:'inventory-recon',window,batchId:'verify-inventory-recon-2026-10-v1'};
const runId=idFor('inventory-recon',request.tenantId,request.storeId,request.batchId,'2026-10');
await pool.query("INSERT IGNORE INTO wfs_inventory_recon_runs (id,tenant_id,store_id,report_month,batch_key,request_id,status,created_at) VALUES (?,?,?,'2026-10',?,?,'requested',UTC_TIMESTAMP(3))",[runId,request.tenantId,request.storeId,request.batchId,saved.requestId]);
const w=createSyncWorker(undefined,'inventory-recon-live-verification',undefined,1);
const existing=await w.queue.getJob(syncJobId(request));
if(existing&&await existing.getState()==='completed')await existing.remove();
await enqueueSync(request,w.queue);
console.log('Queued inventory reconciliation verification',syncJobId(request));
w.worker.on('completed',async(job)=>{
 if(job.id!==syncJobId(request))return;
 const [rows]:any=await pool.query("SELECT COUNT(*) n,SUM(starting_quantity) AS opening_qty,SUM(final_quantity) AS closing_qty,SUM(difference<>0) differences FROM wfs_inventory_recon_rows WHERE run_id=?",[runId]);
 if(rows[0].n!==308||Number(rows[0].opening_qty)!==12311||Number(rows[0].closing_qty)!==13479||Number(rows[0].differences)!==2)throw Error('Live reconciliation failed');
 const [raw]:any=await pool.query("SELECT COUNT(*) n FROM raw_payloads WHERE tenant_id=? AND store_id=? AND resource='inventory-recon' AND external_id=?",[request.tenantId,request.storeId,runId]);
 if(raw[0].n!==1)throw Error('Duplicate raw reports');
 console.log('RAW_REPORTS',raw[0].n);
 console.log('VERIFIED',JSON.stringify(rows[0]),JSON.stringify(job.returnvalue));
 await w.worker.close();await w.queue.close();await w.redis.quit();process.exit(0);
});
w.worker.on('failed',async(_job,error)=>{console.error(error.message);await w.worker.close();await w.queue.close();await w.redis.quit();process.exit(1);});
