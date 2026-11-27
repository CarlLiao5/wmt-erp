import {expect,it} from 'vitest';
import {latestInventoryHealth} from './inventory-health.js';
it('reads latest health with age metadata in one bounded batch, preserving zero and missing values',async()=>{
 const sizes:number[]=[];const snapshots=Array.from({length:462},(_,i)=>({id:String(i),store_id:'s',sku:'SKU-'+i,node_id:'WFS',product_name:'Name',first_in_stock_date:new Date('2026-01-01'),reserved_units:i===0?'0':null}));
 const pool={query:async(sql:string,params:any[])=>{if(sql.includes('wfs_inventory_health_snapshots'))return [snapshots];sizes.push(params.length-1);return [[{snapshot_id:'0',bucket_name:'0To90days',quantity:'0'}]];}};
 const result=await latestInventoryHealth(pool,'tenant');
 expect(sizes).toEqual([462]);expect(result).toHaveLength(462);expect(result[0]).toMatchObject({reservedQuantity:0,ageDistribution:{'0To90days':0}});expect(result[1].ageDistribution).toBeUndefined();
});
