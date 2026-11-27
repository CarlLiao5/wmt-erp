import {createDb} from '../packages/db/src/db.js';
import {createSyncQueue,reportQueueNameForStore} from '../apps/worker/src/queue.js';
const {pool}=createDb();
const [jobs]:any=await pool.query("SELECT store_id,status,COUNT(*) AS n,MIN(available_at) AS earliest,MAX(available_at) AS latest FROM sync_jobs WHERE resource='inventory-recon' AND idempotency_key LIKE '%:backfill-recon-2026-%-v1' GROUP BY store_id,status");
const [runs]:any=await pool.query("SELECT store_id,report_month,status,request_id,error_message FROM wfs_inventory_recon_runs WHERE report_month BETWEEN '2026-06' AND '2026-09' ORDER BY store_id,report_month");
console.log(JSON.stringify({jobs,runs},null,2));
for(const storeId of [...new Set(jobs.map((j:any)=>j.store_id))] as string[]){
 const q=createSyncQueue(undefined,reportQueueNameForStore(storeId));
 console.log(JSON.stringify({storeId,workers:(await q.queue.getWorkers()).length,counts:await q.queue.getJobCounts('active','waiting','delayed')}));
 await q.queue.close();await q.redis.quit();
}
process.exit(0);
