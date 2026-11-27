import {expect,it} from 'vitest';
import {archiveOrderPage,normalizeOrderExtensions} from './order-extensions.js';
import {archiveInventoryHealth} from './inventory-health.js';
import {upsertRows} from './common.js';
const scope={tenantId:'t',storeId:'s',sourceId:'src',capturedAt:new Date('2026-11-17T00:00:00Z')};
it('rolls back the original order archive when extension storage fails',async()=>{
 const operations:string[]=[];const pool={getConnection:async()=>({beginTransaction:async()=>{operations.push('begin');},query:async(sql:string)=>{operations.push(sql.split(' ')[2]);if(sql.includes('order_shipping_details'))throw Error('write failed');return [{}];},commit:async()=>{operations.push('commit');},rollback:async()=>{operations.push('rollback');},release:()=>{operations.push('release');}})};
 await expect(archiveOrderPage({orders:[{purchaseOrderId:'PO'}]},scope,pool)).rejects.toThrow('write failed');expect(operations).toEqual(['begin','raw_payloads','order_shipping_details','rollback','release']);
});
it('atomically archives inventory aliases with standard health and age buckets',async()=>{
 const calls:string[]=[];const pool={getConnection:async()=>({beginTransaction:async()=>{},query:async(sql:string)=>{calls.push(sql);return [{}];},commit:async()=>{calls.push('commit');},rollback:async()=>{},release:()=>{}})};
 await archiveInventoryHealth({itemInformation:{sku:'SKU'},inventoryData:{reservedUnits:0,inventoryAge:{old:0}}},scope,pool);expect(calls.filter(x=>x.includes('raw_payloads'))).toHaveLength(2);expect(calls.some(x=>x.includes('wfs_inventory_age_buckets'))).toBe(true);expect(calls.at(-1)).toBe('commit');
});
it('preserves newer and known fields during late or partial order replays',async()=>{
 let query='';await upsertRows({query:async(sql:string)=>{query=sql;}},'order_shipping_details',[{id:'id',tenant_id:'t',store_id:'s',estimated_ship_at:null,captured_at:scope.capturedAt}],true);expect(query).toContain('IF(captured_at<=VALUES(captured_at),COALESCE(VALUES(estimated_ship_at),estimated_ship_at),estimated_ship_at)');
});
it('deduplicates the same upstream state across repeated observations but keeps tracking identity and split states',()=>{
 const page={orders:[{purchaseOrderId:'PO',orderLines:[{lineNumber:'1',item:{sku:'SKU'},orderLineStatuses:{orderLineStatus:[{status:'Shipped',statusQuantity:{amount:1},trackingInfo:{trackingNumber:'A'}},{status:'Shipped',statusQuantity:{amount:1},trackingInfo:{trackingNumber:'B'}}]}}]}]};
 const a=normalizeOrderExtensions(page,scope),b=normalizeOrderExtensions(page,{...scope,sourceId:'new',capturedAt:new Date()});expect(a.statuses.map(x=>x.id)).toEqual(b.statuses.map(x=>x.id));expect(new Set(a.statuses.map(x=>x.id)).size).toBe(2);
});
