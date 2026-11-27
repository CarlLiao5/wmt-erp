import {mysqlConnectionLoader} from '../apps/worker/src/queue.js';
import {syncWfsShipmentCatalog} from '../apps/worker/src/jobs/syncWfsShipments.js';
import {createDb} from '../packages/db/src/db.js';
const tenantId='default',storeId='10001133528';const started=new Date();const {pool}=createDb();
const connection=await mysqlConnectionLoader({tenantId,storeId,resource:'inventory',window:{from:new Date(started.getTime()-5*86400000).toISOString(),to:started.toISOString()}});
console.log(JSON.stringify({started:started.toISOString(),storeId,mode:'incremental'}));
try{const result=await syncWfsShipmentCatalog({tenantId,storeId,mode:'incremental',now:started},connection);const [shipments]:any=await pool.query('SELECT COUNT(*) total,SUM(last_seen_at>=?) refreshed FROM wfs_shipments WHERE tenant_id=? AND store_id=?',[started,tenantId,storeId]);const [items]:any=await pool.query('SELECT COUNT(*) total,SUM(last_seen_at>=?) refreshed FROM wfs_shipment_items WHERE tenant_id=? AND store_id=?',[started,tenantId,storeId]);console.log(JSON.stringify({result,shipments,items,durationSeconds:(Date.now()-started.getTime())/1000}));process.exit(0);}catch(e){console.error(e instanceof Error?e.message:String(e));process.exit(1);}
