import {normalizeItemReport} from './normalization/item-report.js';
import {type RawArchiveRow} from './raw-archive.js';
/** Immutable report snapshots can be compared exactly. Other resources fail closed. */
export async function verifyArchivedCoverage(c:any,row:RawArchiveRow):Promise<boolean>{
 if(row.resource!=='item-report'||!row.store_id)return false;
 const p:any=row.payload,requestId=p?.request?.requestId??p?.requestId;
 if(!requestId||!Array.isArray(p.rows))return false;
 const expected=normalizeItemReport(p.rows,{tenantId:row.tenant_id,storeId:row.store_id,sourceId:row.external_id,capturedAt:new Date(row.received_at),requestId});
 if(expected.snapshots.length!==p.rows.length)return false;
 const [runs]=await c.query('SELECT row_count,captured_at FROM item_report_runs WHERE tenant_id=? AND id=?',[row.tenant_id,expected.run.id]);
 if(runs.length!==1||Number(runs[0].row_count)!==p.rows.length||new Date(runs[0].captured_at).getTime()!==new Date(row.received_at).getTime())return false;
 const [snapshots]=await c.query('SELECT * FROM item_report_snapshots WHERE tenant_id=? AND store_id=? AND run_id=?',[row.tenant_id,row.store_id,expected.run.id]);
 if(snapshots.length!==expected.snapshots.length)return false;
 const stored=new Map(snapshots.map((s:any)=>[s.id,s]));
 for(const s of expected.snapshots){const a:any=stored.get(s.id);if(!a)return false;for(const [k,v] of Object.entries(s)){if(k==='source_id')continue;const actual=a[k];if(v instanceof Date){if(new Date(actual).getTime()!==v.getTime())return false;}else if(v==null){if(actual!=null)return false;}else if(['price','msrp','shipping_weight','reviews_count','average_rating','competitor_price','competitor_ship_price','buy_box_item_price','buy_box_shipping_price','fulfillment_lag_time'].includes(k)){if(Number(v)!==Number(actual))return false;}else if(actual!==v)return false;}}
 const fields:any[]=[];for(let offset=0;offset<snapshots.length;offset+=100){const ids=snapshots.slice(offset,offset+100).map((s:any)=>s.id);const [batch]=await c.query(`SELECT id,field_value FROM item_report_field_values WHERE tenant_id=? AND snapshot_id IN (${ids.map(()=>'?').join(',')})`,[row.tenant_id,...ids]);fields.push(...batch);}
 if(fields.length!==expected.fields.length)return false;const values=new Map(fields.map(f=>[f.id,f.field_value]));return expected.fields.every(f=>values.has(f.id)&&values.get(f.id)===f.field_value);
}
