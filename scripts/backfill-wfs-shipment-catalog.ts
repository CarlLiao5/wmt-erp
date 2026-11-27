import fs from 'node:fs';
import {createDb} from '../packages/db/src/db.js';
import {WfsShipmentRepository} from '../packages/db/src/wfs-shipments.js';
const {pool}=createDb();
const c=await pool.getConnection();
try{
 await c.query('SET SESSION lock_wait_timeout=10');
 const migration=fs.readFileSync('packages/db/migrations/0052_wfs_shipment_catalog.sql','utf8');
 for(const sql of migration.split(';').map(s=>s.trim()).filter(Boolean))await c.query(sql);
 const repo=new WfsShipmentRepository(c);
 const [tenants]:any=await c.query('SELECT DISTINCT tenant_id AS id FROM raw_payloads');let read=0,written=0,skipped=0;
 for(const tenant of tenants){
  for(const resource of ['wfs_shipments','wfs_shipment_items']){
   let offset=0;
   while(true){
    const [rows]:any=await c.query('SELECT id,store_id,payload,received_at FROM raw_payloads WHERE tenant_id=? AND resource=? ORDER BY received_at,id LIMIT 500 OFFSET ?',[tenant.id,resource,offset]);
    if(!rows.length)break;
    await c.beginTransaction();try{for(const row of rows){read++;if(!row.store_id){skipped++;continue;}const raw=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;const ok=await repo.save(resource==='wfs_shipments'?'shipment':'item',raw,{tenantId:tenant.id,storeId:row.store_id,receivedAt:row.received_at},String(row.id));if(ok)written++;else skipped++;}await c.commit();}catch(e){await c.rollback();throw e;}
    offset+=rows.length;console.log(JSON.stringify({resource,read,written,skipped}));
   }
  }
 }
 const [counts]=await c.query('SELECT (SELECT COUNT(*) FROM wfs_shipments) shipments,(SELECT COUNT(*) FROM wfs_shipment_items) items');console.log(JSON.stringify({complete:true,read,written,skipped,counts}));
}catch(e){console.error(e);process.exit(1);}finally{c.release();}process.exit(0);
