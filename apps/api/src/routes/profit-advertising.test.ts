import {expect,it} from 'vitest';
import {reconcileProfitAdvertising} from './profit-advertising.js';
it('accounts for matched spend and lists unknown, unsold and ambiguous SKU spend without dropping money',()=>{
 const sales=[{storeId:'s',sku:'A',itemId:'1',quantity:2},{storeId:'s',sku:'B',itemId:'2',quantity:1}];
 const r=reconcileProfitAdvertising(sales,[{storeId:'s',sku:'A',itemId:'1',spend:'20'},{storeId:'s',sku:'OLD',itemId:'2',spend:'5'},{storeId:'s',sku:'NO-SALES',itemId:'3',spend:'7'},{storeId:'s',sku:null,itemId:null,spend:'3'},{storeId:'s',sku:'A',itemId:'2',spend:'4'}],'站内广告',0);
 expect([...r.allocated.values()].reduce((a,b)=>a+b,0)).toBe(25);
 expect(r.summary).toMatchObject({reported:39,allocated:25,unallocated:14});
 expect(r.missing.map(x=>x.sku)).toContain('NO-SALES');
 expect(r.missing.reduce((s,x)=>s+x.advertisingDifference,0)).toBe(14);
 expect(r.missing.some(x=>x.missing.includes('站内广告关联冲突'))).toBe(true);
});
it('retains SEM gross and discounted differences and reconciles months with no sales',()=>{
 const r=reconcileProfitAdvertising([],[{storeId:'s',sku:'A',itemId:'1',spend:'10'}],'SEM',20);
 expect(r.summary).toMatchObject({reported:10,allocated:0,unallocated:10,netUnallocated:8});
 expect(r.missing[0]).toMatchObject({sku:'A',advertisingDifference:10,advertisingNetDifference:8,orderCount:0});
});
it('deducts known zero-sale product advertising directly, including item-only matches and SEM discounts',()=>{
 const catalog=[{storeId:'s',sku:'A',itemId:'1',quantity:0}];
 const r=reconcileProfitAdvertising([],[{storeId:'s',sku:'A',itemId:'1',spend:'10',reportDate:'2026-09-03'},{storeId:'s',sku:null,itemId:'1',spend:'5',reportDate:'2026-09-04'}],'SEM',20,catalog);
 expect(r.summary).toMatchObject({reported:15,allocated:15,directDeducted:15,unallocated:0});
 expect(r.directCharges.map(r=>r.netAmount)).toEqual([8,4]);expect(r.missing).toEqual([]);expect(r.allocated.size).toBe(0);
});
