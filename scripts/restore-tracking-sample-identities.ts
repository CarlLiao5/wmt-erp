import {createDb} from '../packages/db/src/db.js';
import {normalizeOrderExtensions} from '../packages/db/src/normalization/order-extensions.js';
import {upsertRows} from '../packages/db/src/normalization/common.js';
const {pool}=createDb();let restored=0,pages=0;
try{
 const [stores]:any=await pool.query("SELECT DISTINCT store_id FROM order_line_tracking WHERE tenant_id='default'");
 for(const {store_id:storeId} of stores){
  const [sources]:any=await pool.query("SELECT id FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id='default' AND store_id=? AND resource='orders' ORDER BY received_at DESC LIMIT 100",[storeId]);
  for(const {id} of sources){
   const [raw]:any=await pool.query('SELECT payload,received_at FROM raw_payloads WHERE id=?',[id]);const r=raw[0];const payload=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;
   const values=normalizeOrderExtensions(payload,{tenantId:'default',storeId,sourceId:String(id),capturedAt:r.received_at}).tracking;
   pages++;if(!values.length)continue;
   const c=await pool.getConnection();try{await c.beginTransaction();
    const [existing]:any=await c.query(`SELECT id FROM order_line_tracking WHERE id IN (${values.map(()=>'?')}) FOR UPDATE`,values.map(v=>v.id));const found=new Set(existing.map((x:any)=>x.id));const missing=values.filter(v=>!found.has(v.id));
    // Restore only identities explicitly represented in archived observations.
    await upsertRows(c,'order_line_tracking',missing,true);restored+=new Set(missing.map(v=>v.id)).size;await c.commit();
   }catch(e){await c.rollback();throw e;}finally{c.release();}
  }
 }
 console.log(JSON.stringify({pages,restored,complete:true}));
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
process.exit(process.exitCode??0);
