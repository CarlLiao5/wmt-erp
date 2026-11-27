import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {normalizeOrderExtensions} from '../packages/db/src/normalization/order-extensions.js';
import {upsertRows} from '../packages/db/src/normalization/common.js';
const {pool}=createDb();const c=await pool.getConnection();
try{
 await c.beginTransaction();
 const scope={tenantId:'default',storeId:'10001133528',sourceId:'verify',capturedAt:new Date()};
 const [raw]:any=await c.query("SELECT payload FROM raw_payloads WHERE tenant_id=? AND store_id=? AND resource='orders' ORDER BY received_at DESC LIMIT 1",[scope.tenantId,scope.storeId]);
 const payload=typeof raw[0].payload==='string'?JSON.parse(raw[0].payload):raw[0].payload;
 const values=normalizeOrderExtensions(payload,scope).tracking;assert(values.length);
 const [before]:any=await c.query('SELECT COUNT(*) n FROM order_line_tracking WHERE tenant_id=?',[scope.tenantId]);
 await upsertRows(c,'order_line_tracking',values,true);
 await upsertRows(c,'order_line_tracking',values,true);
 const [after]:any=await c.query('SELECT COUNT(*) n FROM order_line_tracking WHERE tenant_id=?',[scope.tenantId]);
 assert.equal(after[0].n,before[0].n,'Real archived page replay created extra tracking rows');
 const original=values.find(r=>r.tracking_number&&r.carrier);assert(original);
 const newer={...original,captured_at:new Date('2090-01-01'),tracking_url:'https://verify.invalid/new',method_code:'NEW'};
 await upsertRows(c,'order_line_tracking',[newer],true);
 await upsertRows(c,'order_line_tracking',[{...original,captured_at:new Date('2000-01-01'),tracking_url:'https://verify.invalid/old',method_code:'OLD'}],true);
 const [saved]:any=await c.query('SELECT tracking_url,method_code FROM order_line_tracking WHERE id=?',[original.id]);assert.equal(saved[0].tracking_url,newer.tracking_url);assert.equal(saved[0].method_code,'NEW');
 console.log(JSON.stringify({replayed:values.length,repeatedReplayAddedRows:0,olderReplayPreservedNewerFields:true,rolledBack:true}));
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}finally{await c.rollback();c.release();}
process.exit(process.exitCode??0);
