import {it,expect} from 'vitest';
import {inventoryReconMonths,reconDbRows} from './syncInventoryRecon.js';
import {parseInventoryRecon} from '../../../../packages/walmart-client/src/adapters/inventoryRecon.js';

it('splits history into complete months and rejects the current month',()=>{
 const now=new Date('2026-11-20Z');
 expect(inventoryReconMonths('2026-08-15','2026-10-31',now)).toEqual(['2026-08','2026-09','2026-10']);
 expect(()=>inventoryReconMonths('2026-11-01','2026-11-02',now)).toThrow('completed months');
});
it('retains warehouse identity, report versions and source reconciliation differences',()=>{
 const rows=parseInventoryRecon('Start Date,End Date,GTIN,Item ID,Item Name,SKU,Fulfillment Center,Starting Quantity,Received,Sold,Lost,Found,Undelivered,Transferred,Returned to Seller,Removed,Final Quantity\n2026-10-01,2026-10-31,001,002,Tool,A,FC1,10,2,-3,0,0,0,0,0,0,9\n2026-10-01,2026-10-31,001,002,Tool,A,FC2,4,0,0,0,0,0,0,0,0,3','2026-10');
 const scope={runId:'r1',tenantId:'t',storeId:'s',month:'2026-10'};
 const records=reconDbRows(rows,scope);
 expect(records).toHaveLength(2);
 expect(records.filter(r=>r.difference!==0)).toHaveLength(1);
 expect(records.reduce((s,r)=>s+r.starting_quantity,0)).toBe(14);
 expect(records.reduce((s,r)=>s+r.final_quantity,0)).toBe(12);
 expect(records[0].id).toBe(reconDbRows(rows,scope)[0].id);
 expect(records[0].id).not.toBe(reconDbRows(rows,{...scope,storeId:'s2',runId:'r2'})[0].id);
 expect(()=>reconDbRows([rows[0],rows[0]],scope)).toThrow('Duplicate');
});
