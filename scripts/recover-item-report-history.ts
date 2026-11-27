import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {mysqlConnectionLoader,syncErrorMessage} from '../apps/worker/src/queue.js';
import {downloadItemReport,normalizeItemReportCsv} from '../packages/walmart-client/index.js';
import {persistItemReport} from '../packages/db/src/normalization/item-report.js';
import {transaction,idFor} from '../packages/db/src/normalization/common.js';
const {pool}=createDb();let recovered=0,unavailable=0;
try{
 const [sources]:any=await pool.query("SELECT id,store_id,payload,received_at FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id='default' AND resource='item-report'");
 const missing=sources.filter((r:any)=>{r.payload=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;return !Array.isArray(r.payload.rows);});
 console.log(JSON.stringify({event:'inventory',missing:missing.length}));
 const connections=new Map<string,any>();
 await Promise.all([...new Set<string>(missing.map((r:any)=>r.store_id))].map(async storeId=>{
 for(const raw of missing.filter((r:any)=>r.store_id===storeId)){const request=raw.payload.request??{};const requestId=request.requestId??raw.payload.requestId;
  if(!requestId){unavailable++;console.log(JSON.stringify({event:'unavailable',rawId:raw.id,storeId:raw.store_id,reason:'missing-request-id'}));continue;}
  try{
   const runId=idFor('default',raw.store_id,requestId);const [exists]:any=await pool.query("SELECT id FROM item_report_runs WHERE id=? AND provenance='api-recovered'",[runId]);if(exists.length){console.log(JSON.stringify({event:'already-recovered',rawId:raw.id,requestId}));continue;}
   let connection=connections.get(raw.store_id);if(!connection){connection=await mysqlConnectionLoader({tenantId:'default',storeId:raw.store_id,resource:'item-report',window:{from:'',to:''}});connections.set(raw.store_id,connection);}
   const response=raw.payload.statusResponse??{status:'READY',historicalRecovery:true};
   const report=await downloadItemReport(connection,requestId);const rows=normalizeItemReportCsv(report.content).map(r=>r.fields);
   if(raw.payload.rowCount!=null)assert.equal(rows.length,Number(raw.payload.rowCount),'Historical report row count differs from original metadata');
   const sourceId=`item-report:${requestId}:recovered`;
   const result=await transaction(async c=>{
    await c.query("INSERT INTO raw_payloads (tenant_id,store_id,resource,external_id,payload,http_status,correlation_id,received_at) VALUES ('default',?,'item-report',?,?,200,?,?)",[raw.store_id,sourceId,JSON.stringify({request,statusResponse:response,downloadMetadata:report.metadata,rowCount:rows.length,rows,recovery:{originalRawId:String(raw.id),originalCapturedAt:raw.received_at,recoveredAt:new Date()}}),requestId,raw.received_at]);
    return persistItemReport(c,rows,{tenantId:'default',storeId:raw.store_id,requestId,sourceId,capturedAt:raw.received_at,provenance:'api-recovered'});
   },pool);
   recovered++;console.log(JSON.stringify({event:'recovered',rawId:raw.id,storeId:raw.store_id,requestId,rows:result.snapshots.length,fields:result.fields.length}));
  }catch(e){unavailable++;console.log(JSON.stringify({event:'unavailable',rawId:raw.id,storeId:raw.store_id,requestId,reason:syncErrorMessage(e)}));}
 }
 }));
 console.log(JSON.stringify({complete:true,oldReports:missing.length,recovered,unavailable}));
}catch(e){console.error(syncErrorMessage(e));process.exitCode=1;}
process.exit(process.exitCode??0);
