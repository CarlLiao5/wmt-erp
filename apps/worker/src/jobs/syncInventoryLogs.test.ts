import { expect, it } from 'vitest';
import { syncInventoryLogPages } from './syncInventoryLogs.js';

it.each(['initial', 'incremental'])('%s includes zero stock, deduplicates nodes, and preserves paging window', async () => {
  const queries: any[] = [], saved: string[] = [], raw: number[] = [];
  const result = await syncInventoryLogPages([{sku:'zero',gtin:'g',quantity:0},{sku:'zero',gtin:'g',quantity:5},{sku:'missing',gtin:''}], {from:'2026-11-12',to:'2026-11-17'}, {
    fetch: async q => { queries.push(q); return {payload:{inventoryLog:q.offset===0?Array.from({length:50},(_,i)=>({id:String(i)})):[{id:'last'}]}}; },
    archive: async (_row,offset) => {raw.push(offset);}, save:async (_row,log)=>{saved.push(log.id);}
  });
  expect(queries).toEqual([expect.objectContaining({gtin:'g',offset:0,startDate:'2026-11-12',endDate:'2026-11-17'}),expect.objectContaining({offset:50})]);
  expect(raw).toEqual([0,50]);expect(saved).toHaveLength(51);
  expect(result).toMatchObject({skus:1,skippedSkus:['missing'],pages:2,rows:51,failures:[]});
});

it('continues after a write failure and exposes SKU, offset and successful counts', async () => {
  const result=await syncInventoryLogPages([{sku:'bad',gtin:'g1'},{sku:'good',gtin:'g2'}],{from:'2026-11-12',to:'2026-11-17'},{fetch:async()=>({inventoryLog:[{id:'1'}]}),archive:async()=>{},save:async row=>{if(row.sku==='bad')throw Error('write failed');}});
  expect(result).toMatchObject({pages:2,rows:1,failures:[{sku:'bad',gtin:'g1',offset:0,error:'write failed'}]});
});
