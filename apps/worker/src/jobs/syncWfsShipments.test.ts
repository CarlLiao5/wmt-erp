import {expect,it} from 'vitest';
import {syncWfsShipmentCatalog} from './syncWfsShipments.js';
const connection={} as any;
it.each(['full','initial'] as const)('%s fetches all history and every item page, with raw + normalized saves',async(mode)=>{
 const queries:any[]=[],saved:any[]=[];
 const result=await syncWfsShipmentCatalog({tenantId:'t',storeId:'s',mode},connection,{listShipments:async function*(_c,q){queries.push(q);yield {shipmentId:'old'};yield {shipmentId:'new'};},listItems:async function*(_c,q){yield {sku:'sku',itemQty:3};yield {sku:'sku2',itemQty:2};},archive:async(kind,payload)=>{saved.push({kind,payload});},openShipments:async()=>['unused']});
 expect(queries).toEqual([{}]);expect(result).toMatchObject({shipments:2,items:4});expect(saved).toHaveLength(6);expect(saved.find(r=>r.kind==='item').payload.shipmentId).toBe('OLD');
});
it('incremental discovers from today minus five days and refreshes older nonterminal shipments',async()=>{
 const queries:any[]=[],saved:any[]=[];
 await syncWfsShipmentCatalog({tenantId:'t',storeId:'s',mode:'incremental',now:new Date('2026-11-17T12:00:00Z')},connection,{listShipments:async function*(_c,q){queries.push(q);yield {shipmentId:q.shipmentId||'new'};},listItems:async function*(){yield {sku:'a'};},archive:async(kind,payload)=>{saved.push({kind,payload});},openShipments:async()=>['old','new']});
 expect(queries[0]).toEqual({fromCreateDate:'2026-11-12T12:00:00.000Z',toCreateDate:'2026-11-17T12:00:00.000Z'});expect(queries[1]).toEqual({shipmentId:'old'});expect(queries).toHaveLength(2);expect(saved.filter(r=>r.kind==='item')).toHaveLength(2);
});

it('fails a sync when item fetching fails so missing detail pages are retried',async()=>{
 await expect(syncWfsShipmentCatalog({tenantId:'t',storeId:'s',mode:'full'},connection,{listShipments:async function*(){yield {shipmentId:'S1'};},listItems:async function*(){throw Error('failed item page');},archive:async()=>{},openShipments:async()=>[]})).rejects.toThrow('failed item page');
});
