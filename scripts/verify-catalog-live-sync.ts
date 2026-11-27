import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDb} from '../packages/db/src/db.js';
import {processSyncRequest} from '../apps/worker/src/queue.js';
const {pool}=createDb();
const tenantId='default',storeId=process.argv[2]??'10001133528';
async function catalog(){const [rows]:any=await pool.query('SELECT external_id AS sku,item_id AS itemId,gtin,title FROM skus WHERE tenant_id=? AND store_id=?',[tenantId,storeId]);return rows;}
try{
 for(const mode of ['initial','incremental'] as const){
  const before=await catalog(); const to=new Date(),from=new Date(to.getTime()-5*86400000);
  const batchId=`catalog-${mode}-${randomUUID()}`;
  console.log(JSON.stringify({event:'started',storeId,mode,batchId,before:before.length,at:new Date().toISOString()}));
  const result=await processSyncRequest({tenantId,storeId,resource:'inventory',window:{from:from.toISOString(),to:to.toISOString()},batchId,state:{shipmentMode:mode}});
  const after=await catalog();const index=new Map(after.map((r:any)=>[r.sku,r]));
  const lost=before.filter((r:any)=>r.itemId && !(index.get(r.sku) as any)?.itemId);
  const changed=before.filter((r:any)=>r.itemId && (index.get(r.sku) as any)?.itemId!==r.itemId);
  console.log(JSON.stringify({event:'finished',storeId,mode,batchId,result,after:after.length,lostItemIds:lost.length,changedItemIds:changed.length,at:new Date().toISOString()}));
  assert.equal(lost.length,0,'Existing Item IDs lost');assert.equal(changed.length,0,'Existing Item IDs changed: investigate');
 }
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
process.exit(process.exitCode??0);
