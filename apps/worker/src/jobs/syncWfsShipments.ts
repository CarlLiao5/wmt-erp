import {listWfsShipments,listWfsShipmentItems,type WalmartConnection} from '@walmart-erp/walmart-client';
import {WfsShipmentRepository} from '../../../../packages/db/src/wfs-shipments.js';
export type ShipmentSyncMode='full'|'initial'|'incremental';
type Input={tenantId:string;storeId:string;mode:ShipmentSyncMode;now?:Date};
type Dependencies={listShipments:(c:WalmartConnection,q:Record<string,string>)=>AsyncIterable<any>;listItems:(c:WalmartConnection,q:Record<string,string>)=>AsyncIterable<any>;archive:(kind:'shipment'|'item',raw:any)=>Promise<void>;openShipments:()=>Promise<string[]>};
export async function syncWfsShipmentCatalog(input:Input,connection:WalmartConnection,deps?:Dependencies){
 const now=input.now??new Date();const scope={tenantId:input.tenantId,storeId:input.storeId,receivedAt:now};
 const repo=deps?undefined:new WfsShipmentRepository();
 const api=deps??{listShipments:listWfsShipments,listItems:listWfsShipmentItems,archive:(kind,raw)=>repo!.archive(kind,raw,scope),openShipments:()=>repo!.openShipments(input.tenantId,input.storeId)};
 const query:Record<string,string>=input.mode==='incremental'?{fromCreateDate:new Date(now.getTime()-5*86400000).toISOString(),toCreateDate:now.toISOString()}:{};
 const seen=new Set<string>();let shipments=0,items=0;
 const save=async(shipment:any)=>{const id=String(shipment.shipmentId??shipment.inboundOrderId??'').trim().toUpperCase();if(!id)throw Error('WFS shipment missing identity');if(seen.has(id))return;seen.add(id);await api.archive('shipment',{...shipment,shipmentId:id});shipments++;for await(const item of api.listItems(connection,{shipmentId:id})){await api.archive('item',{...item,shipmentId:id});items++;}};
 for await(const shipment of api.listShipments(connection,query))await save(shipment);
 if(input.mode==='incremental')for(const shipmentId of await api.openShipments()){if(seen.has(shipmentId.toUpperCase()))continue;for await(const shipment of api.listShipments(connection,{shipmentId})){if(String(shipment.shipmentId??shipment.inboundOrderId??'').trim().toUpperCase()===shipmentId.toUpperCase())await save(shipment);}}
 return {resource:'wfs_shipments',mode:input.mode,shipments,items};
}
