import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {mysqlConnectionLoader,syncErrorMessage} from '../apps/worker/src/queue.js';
import {persistItemReportToDatabase} from '../apps/worker/src/jobs/syncItemReport.js';
import {requestItemReport,getItemReportStatus} from '../packages/walmart-client/index.js';
import {normalizeItemReport} from '../packages/db/src/normalization/item-report.js';
const {pool}=createDb();
const status=(r:any)=>String(r?.reportRequest?.status??r?.status??r?.requestStatus??'').toUpperCase();
try{
 const [stores]:any=await pool.query("SELECT s.id,s.name FROM stores s JOIN store_credentials c ON c.store_id=s.id AND c.tenant_id=s.tenant_id WHERE s.tenant_id='default' AND s.environment='production' ORDER BY s.id");
 const pending:any[]=[];
 for(const store of stores){try{
  const connection=await mysqlConnectionLoader({tenantId:'default',storeId:store.id,resource:'item-report',window:{from:'',to:''}});
  const resume=process.env.ITEM_REPORT_RESUME_LOG? (await readFile(process.env.ITEM_REPORT_RESUME_LOG,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(r=>r.event==='submitted'&&r.storeId===store.id):undefined;
  const requested=resume?{requestId:resume.requestId,status:resume.status}:await requestItemReport(connection);pending.push({store,connection,requested});
  console.log(JSON.stringify({event:'submitted',storeId:store.id,name:store.name,requestId:requested.requestId,status:requested.status}));
 }catch(e){console.log(JSON.stringify({event:'failed',storeId:store.id,error:syncErrorMessage(e)}));process.exitCode=1;}}
 const deadline=Date.now()+70*60*1000;
 while(pending.length&&Date.now()<deadline){
  await Promise.all(pending.map(async job=>{try{
   const response=await getItemReportStatus(job.connection,job.requested.requestId);const state=status(response);
   console.log(JSON.stringify({event:'status',storeId:job.store.id,requestId:job.requested.requestId,status:state}));
   if(['FAILED','ERROR'].includes(state))throw Error(`Report failed: ${state}`);
   if(!['READY','COMPLETED','SUCCESS'].includes(state))return;
   const result=await persistItemReportToDatabase({tenantId:'default',storeId:job.store.id},job.connection,job.requested,response);
   const [raw]:any=await pool.query("SELECT payload,received_at FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id='default' AND store_id=? AND resource='item-report' AND external_id=? ORDER BY received_at DESC LIMIT 1",[job.store.id,`item-report:${job.requested.requestId}`]);
   const p=typeof raw[0].payload==='string'?JSON.parse(raw[0].payload):raw[0].payload;assert(Array.isArray(p.rows));
   const expected=normalizeItemReport(p.rows,{tenantId:'default',storeId:job.store.id,sourceId:`item-report:${job.requested.requestId}`,capturedAt:raw[0].received_at,requestId:job.requested.requestId});
   const [runs]:any=await pool.query('SELECT row_count FROM item_report_runs WHERE id=?',[expected.run.id]);assert.equal(runs[0].row_count,expected.snapshots.length);
   const [snapshots]:any=await pool.query('SELECT id FROM item_report_snapshots WHERE run_id=?',[expected.run.id]);assert.deepEqual(new Set(snapshots.map((r:any)=>r.id)),new Set(expected.snapshots.map(r=>r.id)));
   const [fields]:any=await pool.query('SELECT f.id,f.field_value FROM item_report_field_values f JOIN item_report_snapshots s ON s.id=f.snapshot_id WHERE s.run_id=?',[expected.run.id]);const values=new Map(fields.map((r:any)=>[r.id,r.field_value]));assert.equal(fields.length,expected.fields.length);for(const f of expected.fields)assert.equal(values.get(f.id),f.field_value);
   console.log(JSON.stringify({event:'verified',storeId:job.store.id,name:job.store.name,requestId:job.requested.requestId,rawRows:p.rows.length,snapshots:snapshots.length,fields:fields.length,result}));job.done=true;
  }catch(e){console.log(JSON.stringify({event:'failed',storeId:job.store.id,error:syncErrorMessage(e)}));process.exitCode=1;job.done=true;}}));
  for(let i=pending.length-1;i>=0;i--)if(pending[i].done)pending.splice(i,1);
  if(pending.length)await new Promise(r=>setTimeout(r,30000));
 }
 if(pending.length){console.log(JSON.stringify({event:'timeout',stores:pending.map(j=>j.store.id)}));process.exitCode=1;}
}catch(e){console.error(syncErrorMessage(e));process.exitCode=1;}
process.exit(process.exitCode??0);
