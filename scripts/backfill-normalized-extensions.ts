import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {createDb} from '../packages/db/src/db.js';
import {normalizeOrderExtensions} from '../packages/db/src/normalization/order-extensions.js';
import {normalizeInventoryHealth} from '../packages/db/src/normalization/inventory-health.js';
import {normalizeItemReport} from '../packages/db/src/normalization/item-report.js';
import {type RecordRow,upsertRows,transaction} from '../packages/db/src/normalization/common.js';
const {pool}=createDb();
for(const statement of fs.readFileSync('packages/db/migrations/0053_order_inventory_report_normalization.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);
const counts:Record<string,number>={};
const mapping:Record<string,string>={headers:'order_shipping_details',lines:'order_line_extensions',charges:'order_line_charges',statuses:'order_line_status_history',tracking:'order_line_tracking',serials:'order_line_serials'};
const seen=new Map<string,Map<string,number>>();
for(const resource of (process.env.BACKFILL_RESOURCES??'orders,wfs_inventory_health').split(',')){
 let read=0;
 const [scopes]:any=await pool.query('SELECT DISTINCT tenant_id,store_id FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE resource=? AND store_id IS NOT NULL',[resource]);
 for(const sc of scopes){let beforeTime=new Date('2100-01-01'),beforeId='18446744073709551615';
 while(true){const [raws]:any=await pool.query('SELECT id,tenant_id,store_id,external_id,COMPRESS(payload) compressed_payload,received_at FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id=? AND resource=? AND store_id=? AND (received_at<? OR (received_at=? AND id<?)) ORDER BY received_at DESC,id DESC LIMIT 300',[sc.tenant_id,resource,sc.store_id,beforeTime,beforeTime,beforeId]);if(!raws.length)break;
 const batches=new Map<string,Map<string,RecordRow>>();
 for(const raw of raws){beforeId=String(raw.id);beforeTime=raw.received_at;read++;if(!raw.store_id)continue;const scope={tenantId:raw.tenant_id,storeId:raw.store_id,sourceId:raw.external_id??String(raw.id),capturedAt:raw.received_at};const payload=JSON.parse(inflateSync(raw.compressed_payload.subarray(4)).toString('utf8'));
 const normalized=resource==='orders'?normalizeOrderExtensions(payload,scope):normalizeInventoryHealth(payload,scope);
 for(const [kind,records] of Object.entries(normalized)){const table=resource==='orders'?mapping[kind]:kind==='snapshots'?'wfs_inventory_health_snapshots':'wfs_inventory_age_buckets';const unique=seen.get(table)??new Map<string,number>();seen.set(table,unique);const batch=batches.get(table)??new Map<string,RecordRow>();batches.set(table,batch);for(const row of records){if((unique.get(row.id)??-Infinity)>=row.captured_at.getTime())continue;unique.set(row.id,row.captured_at.getTime());batch.set(row.id,row);}}
 }
 await transaction(async c=>{for(const [table,entries] of batches){const values=[...entries.values()];await upsertRows(c,table,values,resource==='orders');counts[table]=(counts[table]??0)+values.length;}},pool);
 if(read%1500===0)console.log(JSON.stringify({resource,read,counts}));
 }
 }
 console.log(JSON.stringify({resource,complete:true,read,counts}));
}
// Old ITEM raw archives contain metadata, not CSV rows. Recover only available current fields.
if(process.env.BACKFILL_RESOURCES==='orders'){console.log(JSON.stringify({complete:true,counts}));process.exit(0);}
const [skuRows]:any=await pool.query("SELECT tenant_id,store_id,external_id,details,updated_at FROM skus WHERE JSON_EXTRACT(details,'$.itemReport') IS NOT NULL");
const groups=new Map<string,any>();
// SKU updated_at also changes on unrelated syncs. Unknown legacy report dates
// must remain older than actual API snapshots rather than masquerading as new.
const legacyCapturedAt=new Date('1970-01-01T00:00:00Z');
for(const row of skuRows){const f=(typeof row.details==='string'?JSON.parse(row.details):row.details)?.itemReport;if(!f)continue;const key=JSON.stringify([row.tenant_id,row.store_id]);const g=groups.get(key)??{tenantId:row.tenant_id,storeId:row.store_id,capturedAt:legacyCapturedAt,fields:[]};g.fields.push({...f,SKU:f.SKU??row.external_id});groups.set(key,g);}
for(const g of groups.values()){const requestId=`legacy-current:${g.capturedAt.toISOString()}`;const data=normalizeItemReport(g.fields,{...g,sourceId:requestId,requestId,provenance:'legacy-current'});await transaction(async c=>{for(const [table,values] of [['item_report_runs',[data.run]],['item_report_snapshots',data.snapshots],['item_report_field_values',data.fields]] as const){await upsertRows(c,table,[...values]);counts[table]=(counts[table]??0)+values.length;}},pool);}
console.log(JSON.stringify({complete:true,counts}));process.exit(0);
