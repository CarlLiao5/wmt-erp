import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDb} from '../packages/db/src/db.js';
import {WfsShipmentRepository,normalizeWfsShipment,normalizeWfsShipmentItem} from '../packages/db/src/wfs-shipments.js';
const {pool}=createDb();const [tenants]:any=await pool.query('SELECT DISTINCT tenant_id AS id FROM raw_payloads');
const repo=new WfsShipmentRepository(pool);let rawCount=0,shipments=0,items=0;
for(const {id:tenantId} of tenants){
 for(const kind of ['shipment','item'] as const){
 const [rawRows]:any=await pool.query('SELECT id,store_id,payload,received_at FROM raw_payloads WHERE tenant_id=? AND resource=? ORDER BY received_at,id',[tenantId,kind==='shipment'?'wfs_shipments':'wfs_shipment_items']);
 const latest=new Map<string,any>();
 for(const row of rawRows){rawCount++;if(!row.store_id)continue;const raw=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;const scope={tenantId,storeId:row.store_id,receivedAt:row.received_at};const normalized=kind==='shipment'?normalizeWfsShipment(raw,scope):normalizeWfsShipmentItem(raw,scope);if(normalized)latest.set(normalized.id,{...normalized,sourceId:String(row.id)});}
 const [actual]:any=await pool.query(`SELECT * FROM ${kind==='shipment'?'wfs_shipments':'wfs_shipment_items'} WHERE tenant_id=?`,[tenantId]);
 assert.equal(actual.length,latest.size);
 for(const row of actual){const expected=latest.get(row.id);assert.ok(expected);assert.equal(row.shipment_id,expected.shipmentId);assert.equal(row.source_raw_id,expected.sourceId);if(kind==='shipment')assert.equal(row.status,expected.status);else {assert.equal(row.sku,expected.sku);assert.equal(row.planned_quantity==null?null:Number(row.planned_quantity),expected.plannedQuantity);}}
 if(kind==='shipment')shipments+=actual.length;else items+=actual.length;
 }
 const fromRepo=await repo.list(tenantId);assert.ok(fromRepo.every(r=>r.storeId));const details=await repo.items(tenantId);assert.ok(details.every(r=>r.payload.shipmentId));
}
const c=await pool.getConnection();await c.beginTransaction();try{
 const scope={tenantId:'verify-wfs',storeId:'verify-store',receivedAt:new Date('2026-11-17T00:00:00Z')};const transactionRepo=new WfsShipmentRepository(c);
 await transactionRepo.save('shipment',{shipmentId:'TEST1',status:'Receiving',actualDeliveryDate:'2026-11-10'},scope,'latest');
 await transactionRepo.save('shipment',{shipmentId:'TEST1',status:'Created'}, {...scope,receivedAt:new Date('2026-01-01')},'older');
 const [saved]:any=await c.query("SELECT status,source_raw_id,actual_delivery_date FROM wfs_shipments WHERE tenant_id='verify-wfs'");assert.equal(saved[0].status,'Receiving');assert.equal(saved[0].source_raw_id,'latest');assert.ok(saved[0].actual_delivery_date);
 const nested:any={getConnection:async()=>({query:c.query.bind(c),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}})};
 const archiveRepo=new WfsShipmentRepository(nested);await archiveRepo.archive('shipment',{shipmentId:'TEST2',status:'Delivered'},scope);await archiveRepo.archive('item',{shipmentId:'TEST2',sku:'SKU1',itemQty:4032,receivedQty:0},scope);
 const [archived]:any=await c.query("SELECT s.shipment_id,r.resource FROM wfs_shipments s JOIN raw_payloads r ON r.id=s.source_raw_id WHERE s.tenant_id='verify-wfs' AND s.shipment_id='TEST2'");assert.equal(archived[0].resource,'wfs_shipments');
 const open=await transactionRepo.openShipments(scope.tenantId,scope.storeId);assert.ok(open.includes('TEST2'));
 await transactionRepo.save('shipment',{shipmentId:'TEST2',status:'Closed'}, {...scope,receivedAt:new Date('2026-11-18')});assert.ok(!(await transactionRepo.openShipments(scope.tenantId,scope.storeId)).includes('TEST2'));
}finally{await c.rollback();c.release();}
console.log(JSON.stringify({rawCount,shipments,items,latestSourceParity:true,transactionalArchiveAndStaleGuards:'passed, rolled back'}));process.exit(0);
