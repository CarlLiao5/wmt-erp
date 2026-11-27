import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {normalizeItemReport,reportNumberFields} from '../packages/db/src/normalization/item-report.js';
import {idFor} from '../packages/db/src/normalization/common.js';
const {pool}=createDb();
try {
 const [raw]:any=await pool.query("SELECT id,store_id,payload,received_at FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id='default' AND resource='item-report'");
 const [allValues]:any=await pool.query("SELECT id,snapshot_id,field_value FROM item_report_field_values WHERE tenant_id='default'");const fieldsBySnapshot=new Map<string,any[]>();for(const value of allValues){const group=fieldsBySnapshot.get(value.snapshot_id)??[];group.push(value);fieldsBySnapshot.set(value.snapshot_id,group);}
 let complete=0,metadataOnly=0,resolved=0,unresolved=0,snapshots=0,fields=0;
 const byStore=new Map<string,any>();
 const expectedRuns=new Set<string>();
 for(const r of raw){const p=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;const requestId=p.request?.requestId??p.requestId;
  if(!Array.isArray(p.rows)){metadataOnly++;const [runs]:any=await pool.query('SELECT provenance FROM item_report_runs WHERE id=?',[idFor('default',r.store_id,requestId)]);if(runs.some((x:any)=>x.provenance==='api-recovered'))resolved++;else unresolved++;continue;}
  assert(requestId);complete++;
  const expected=normalizeItemReport(p.rows,{tenantId:'default',storeId:r.store_id,requestId,sourceId:'audit',capturedAt:r.received_at});
  assert.equal(expected.snapshots.length,p.rows.length,`Raw report has missing or duplicate SKUs: ${requestId}`);
  const [run]:any=await pool.query('SELECT row_count,provenance,captured_at FROM item_report_runs WHERE id=?',[expected.run.id]);assert.equal(run.length,1);assert.equal(run[0].row_count,p.rows.length);assert.equal(new Date(run[0].captured_at).getTime(),new Date(r.received_at).getTime(),`Run capture time mismatch: ${requestId}`);
  const [actual]:any=await pool.query('SELECT * FROM item_report_snapshots WHERE run_id=?',[expected.run.id]);const actualMap=new Map(actual.map((a:any)=>[a.id,a]));assert.equal(actual.length,expected.snapshots.length);
  for(const snapshot of expected.snapshots){const a:any=actualMap.get(snapshot.id);assert(a);for(const [key,value] of Object.entries(snapshot)){if(key==='source_id')continue;const stored=a[key];if(value instanceof Date)assert.equal(new Date(stored).getTime(),value.getTime());else if(value==null)assert.equal(stored,null);else if(typeof stored==='string'&&typeof value==='number')assert.equal(Number(stored),value);else if(key in reportNumberFields&&value!=null)assert.equal(Number(stored),Number(value));else assert.equal(stored,value);}}
  const values:any[]=actual.flatMap((r:any)=>fieldsBySnapshot.get(r.id)??[]);assert.equal(values.length,expected.fields.length);const valueMap=new Map(values.map((f:any)=>[f.id,f.field_value]));for(const f of expected.fields)assert.equal(valueMap.get(f.id),f.field_value);
  if(!expectedRuns.has(expected.run.id)){expectedRuns.add(expected.run.id);snapshots+=actual.length;fields+=values.length;const store=byStore.get(r.store_id)??{reports:0,snapshots:0,fields:0};store.reports++;store.snapshots+=actual.length;store.fields+=values.length;byStore.set(r.store_id,store);}
 }
 console.log(JSON.stringify({complete:true,rawCompleteReports:complete,distinctVerifiedRuns:expectedRuns.size,snapshots,fields,oldMetadataOnly:metadataOnly,oldRecovered:resolved,oldUnresolved:unresolved,stores:Object.fromEntries(byStore)}));
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
process.exit(process.exitCode??0);
