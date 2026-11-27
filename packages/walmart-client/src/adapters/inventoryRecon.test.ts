import {it,expect} from 'vitest';
import {inventoryReconWindow,parseInventoryRecon} from './inventoryRecon.js';
import {assertReadOnly} from '../readonly.js';
it('accepts only a bounded valid reconciliation report request',()=>{
 const path='/v3/reports/reportRequests?reportType=INVENTORY_RECON&reportVersion=v1';
 const body={dataStartTime:'2026-10-01T00:00:00.000Z',dataEndTime:'2026-10-31T23:59:59.999Z'};
 expect(()=>assertReadOnly('POST',path,JSON.stringify(body))).not.toThrow();
 expect(()=>assertReadOnly('POST',path,JSON.stringify({...body,extra:1}))).toThrow();
 expect(()=>assertReadOnly('POST',path,JSON.stringify({...body,dataEndTime:'bad'}))).toThrow();
 expect(()=>assertReadOnly('POST',path,JSON.stringify({...body,dataEndTime:'2027-10-31T23:59:59.999Z'}))).toThrow();
});
it('builds a complete calendar month and rejects partial/multi-month ranges',()=>{
 expect(inventoryReconWindow('2026-10-01','2026-10-31')).toEqual({dataStartTime:'2026-10-01T00:00:00.000Z',dataEndTime:'2026-10-31T23:59:59.999Z'});
 expect(()=>inventoryReconWindow('2026-10-02','2026-11-01')).toThrow();
});
it('preserves warehouse rows, signed movements, identifiers and reconciliation differences',()=>{
 const csv='Start Date,End Date,GTIN,Item ID,Item Name,SKU,Fulfillment Center,Starting Quantity,Received,Sold,Lost,Found,Undelivered,Transferred,Returned to Seller,Removed,Final Quantity\n2026-10-01,2026-10-31,001,002,"Tool, red",A,FC1,10,2,-3,0,0,0,0,0,0,9\n2026-10-01,2026-10-31,001,002,Tool,A,FC2,4,0,0,0,0,0,0,0,0,3';
 const rows=parseInventoryRecon(csv,'2026-10');
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({sku:'A',gtin:'001',itemId:'002',startingQuantity:10,sold:-3,finalQuantity:9,difference:0});
 expect(rows[1].difference).toBe(-1);
 expect(()=>parseInventoryRecon(csv,'2026-09')).toThrow();
 expect(()=>parseInventoryRecon('SKU\nA','2026-10')).toThrow();
});
