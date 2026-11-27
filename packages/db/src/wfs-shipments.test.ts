import {expect,it} from 'vitest';
import {normalizeWfsShipment,normalizeWfsShipmentItem,WfsShipmentRepository} from './wfs-shipments.js';
const scope={tenantId:'t',storeId:'s',receivedAt:new Date('2026-11-17T00:00:00Z')};
it('returns standardized descriptions and receiving progress in the shipment detail contract',async()=>{
 const repo=new WfsShipmentRepository({query:async()=>[[{store_id:'s',shipment_id:'S1',sku:'SKU',product_name:'产品描述',planned_quantity:'60',received_quantity:'0',damaged_quantity:'0'}],[]]} as any);
 const [row]=await repo.items('t','s');
 expect(row.payload).toMatchObject({itemDesc:'产品描述',productName:'产品描述',itemQty:60,receivedQty:0,fillRate:0});
 expect(row.payload).not.toHaveProperty('actualReceivedQty');
});
it('normalizes independent shipment and item fields with scoped stable identities',()=>{
 const s=normalizeWfsShipment({shipmentId:'7858663WFA',status:'Receiving',createdDate:'2026-01-01',actualDeliveryDate:'2026-01-05',shipToAddress:{shipNode:'LAX2T'}},scope)!;
 expect(s).toMatchObject({shipmentId:'7858663WFA',status:'Receiving',shipToAddress:{shipNode:'LAX2T'}});expect(s.actualDeliveryDate?.toISOString()).toContain('2026-01-05');
 expect(normalizeWfsShipment({...s}, {...scope,storeId:'other'})?.id).not.toBe(s.id);
 const item=normalizeWfsShipmentItem({sku:'XMDK-NSB-001',itemQty:4032,receivedQty:4000}, {...scope,shipmentId:s.shipmentId})!;
 expect(item).toMatchObject({shipmentId:'7858663WFA',sku:'XMDK-NSB-001',plannedQuantity:4032,receivedQuantity:4000});
 expect(normalizeWfsShipment({},scope)).toBeNull();expect(normalizeWfsShipmentItem({}, {...scope,shipmentId:'s'})).toBeNull();
});
it('guards persisted current values against older historical responses',async()=>{
 const writes:any[]=[];const repo=new WfsShipmentRepository({query:async(sql:string,values:any[])=>{writes.push({sql,values});return [[],[]];}} as any);
 await repo.save('shipment',{shipmentId:'S1',status:'Receiving'},scope,'raw1');
 expect(writes[0].sql).toContain('last_seen_at <= VALUES(last_seen_at)');expect(writes[0].values).toContain('raw1');
});
