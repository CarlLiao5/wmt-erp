import {reportWait,ReportDeferred} from '../../../../packages/walmart-client/src/reportContinuation.js';
import {createDb} from '../../../../packages/db/src/db.js';
import {idFor,transaction,upsertRows} from '../../../../packages/db/src/normalization/common.js';
import {parseInventoryRecon,requestInventoryRecon,getInventoryReconStatus,downloadInventoryRecon} from '../../../../packages/walmart-client/src/adapters/inventoryRecon.js';
import type {WalmartConnection} from '../../../../packages/walmart-client/src/types.js';

type Window={tenantId:string;storeId:string;from:string;to:string;batchId?:string};
export function inventoryReconMonths(from:string,to:string,now=new Date()) {
 const start=new Date(from),end=new Date(to);
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end)throw Error('Invalid inventory reconciliation window');
 const months:string[]=[];
 for(let d=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));d<=end;d.setUTCMonth(d.getUTCMonth()+1)){
  if(d.getUTCFullYear()===now.getUTCFullYear()&&d.getUTCMonth()===now.getUTCMonth()||d>now)throw Error('Inventory reconciliation only supports completed months');
  months.push(d.toISOString().slice(0,7));
  if(months.length>120)throw Error('Inventory reconciliation window exceeds 120 months');
 }
 return months;
}
export function reconDbRows(rows:ReturnType<typeof parseInventoryRecon>,scope:{runId:string;tenantId:string;storeId:string;month:string}) {
 const keys=new Set<string>();
 return rows.map(row=>{
  const key=JSON.stringify([row.sku,row.fulfillmentCenter]);
  if(keys.has(key))throw Error('Duplicate inventory reconciliation SKU/warehouse: '+row.sku);
  keys.add(key);
  return {id:idFor(scope.runId,row.sku,row.fulfillmentCenter),run_id:scope.runId,tenant_id:scope.tenantId,store_id:scope.storeId,report_month:scope.month,
   sku:row.sku,gtin:row.gtin,item_id:row.itemId,item_name:row.itemName,fulfillment_center:row.fulfillmentCenter,
   starting_quantity:row.startingQuantity,received:row.received,sold:row.sold,lost:row.lost,found:row.found,undelivered:row.undelivered,
   transferred:row.transferred,returned_to_seller:row.returnedToSeller,removed:row.removed,final_quantity:row.finalQuantity,difference:row.difference};
 });
}
export async function persistInventoryRecon(window:Window,runId:string,month:string,requestId:string,content:Uint8Array|string,statusResponse:unknown) {
 const rows=parseInventoryRecon(content,month);
 const normalized=reconDbRows(rows,{runId,tenantId:window.tenantId,storeId:window.storeId,month});
 const summary={rows:rows.length,differences:rows.filter(r=>r.difference!==0).length,startingQuantity:rows.reduce((s,r)=>s+r.startingQuantity,0),finalQuantity:rows.reduce((s,r)=>s+r.finalQuantity,0)};
 await transaction(async c=>{
  await c.query("INSERT INTO raw_payloads (tenant_id,store_id,resource,external_id,payload,http_status,correlation_id,received_at) VALUES (?,?,'inventory-recon',?,?,200,?,UTC_TIMESTAMP(3))",
   [window.tenantId,window.storeId,runId,JSON.stringify({requestId,month,statusResponse,csv:typeof content==='string'?content:new TextDecoder().decode(content)}),requestId]);
  await upsertRows(c,'wfs_inventory_recon_rows',normalized);
  await c.query("UPDATE wfs_inventory_recon_runs SET status='completed',row_count=?,difference_count=?,starting_quantity=?,final_quantity=?,completed_at=UTC_TIMESTAMP(3),error_message=NULL WHERE id=? AND tenant_id=? AND store_id=?",
   [summary.rows,summary.differences,summary.startingQuantity,summary.finalQuantity,runId,window.tenantId,window.storeId]);
 });
 return summary;
}
export async function syncInventoryReconToDatabase(window:Window,connection:WalmartConnection) {
 const {pool}=createDb();
 const results=[];
 const progress = async (phase:string,month:string,requestId?:string) => {
  if(!window.batchId)return;
  const key=['sync',window.storeId,'inventory-recon',window.from,window.to,window.batchId].join(':');
  await pool.query("UPDATE sync_jobs SET result_payload=? WHERE tenant_id=? AND store_id=? AND idempotency_key=? AND status='running'",
   [JSON.stringify({resource:'inventory-recon',phase,month,requestId}),window.tenantId,window.storeId,key]);
 };
 for(const month of inventoryReconMonths(window.from,window.to)){
  const runId=idFor('inventory-recon',window.tenantId,window.storeId,window.batchId??window.from+':'+window.to,month);
  await pool.query("INSERT IGNORE INTO wfs_inventory_recon_runs (id,tenant_id,store_id,report_month,batch_key,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))",
   [runId,window.tenantId,window.storeId,month,window.batchId??window.from+':'+window.to]);
  const [runs]:any=await pool.query('SELECT request_id,status,row_count,difference_count FROM wfs_inventory_recon_runs WHERE id=?',[runId]);
  const run=runs[0];
  if(run.status==='completed'){results.push({month,rows:run.row_count,received:0,normalized:0,differences:run.difference_count,reused:true});continue;}
  try{
   let requestId=run.request_id as string|undefined;
   if(!requestId){
    await progress("正在申请报告",month);
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
    const requested=await requestInventoryRecon(connection,month+'-01',end);
    requestId=requested.requestId;
    await pool.query("UPDATE wfs_inventory_recon_runs SET request_id=?,status='requested',error_message=NULL WHERE id=?",[requestId,runId]);
   }
   await progress("报告生成中，等待 Walmart 返回",month,requestId);
   let response:any;
   let ready=false;
   for(let attempt=0;attempt<7;attempt++){
    response=await getInventoryReconStatus(connection,requestId);
    const status=String(response.requestStatus??response.reportRequest?.status??response.status??'').toUpperCase();
    if(['READY','COMPLETED','SUCCESS'].includes(status)){ready=true;break;}
    if(['ERROR','FAILED'].includes(status))throw Error('Inventory reconciliation report '+requestId+' failed: '+status);
    if(attempt<6)await reportWait(600000);
   }
   if(!ready)throw Error('Inventory reconciliation report pending; retry resumes request '+requestId);
   await pool.query("UPDATE wfs_inventory_recon_runs SET status='ready' WHERE id=?",[runId]);
   await progress("报告已生成，正在下载",month,requestId);
   const report=await downloadInventoryRecon(connection,requestId);
   await progress("正在标准化入库",month,requestId);
   const summary=await persistInventoryRecon(window,runId,month,requestId,report.content,response);
   results.push({month,requestId,received:summary.rows,normalized:summary.rows,...summary});
  }catch(error){
   if(error instanceof ReportDeferred)throw error;
   await pool.query("UPDATE wfs_inventory_recon_runs SET status='failed',error_message=? WHERE id=?",
    [error instanceof Error?error.message.slice(0,500):'Report failed',runId]);
   throw error;
  }
 }
 return {resource:'inventory-recon',received:results.reduce((s,r)=>s+r.received,0),normalized:results.reduce((s,r)=>s+r.normalized,0),differences:results.reduce((s,r)=>s+r.differences,0),results};
}
