import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { returnReconciliationWorkbook } from './return-reconciliation-export.js';
it('exports every result page with separate evidence, preserving order ids as text and amounts as numbers', async () => {
 const calls: any[]=[];
 const record=(id:string)=>({id,storeId:'s',orderId:`s:00123456789012345678${id}`,sku:'SKU',status:'REFUNDED',refundCoveredBy:'Walmart'});
 const buffer=await returnReconciliationWorkbook('t',{page:99,pageSize:20,from:'2026-11-01'},async(tenant,q)=>{calls.push([tenant,q]);return {rows:[record(String(q.page))],total:101} as any;},async(_tenant,rows)=>rows.map(row=>({...row,reconciliation:{refundDebit:10,commissionCredit:1,returnFees:0,compensation:0,netDebit:9,currency:'USD',status:'已扣款',transactions:[{id:'x',amount:-10,currency:'USD',description:'Return Refund',transactionType:'Refund',amountType:'Product Price'}]}})));
 expect(calls).toHaveLength(2);expect(calls[0][1]).toMatchObject({page:1,pageSize:100,from:'2026-11-01',reconciliation:true,responsibility:'wfs'});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
 expect(workbook.worksheets.map(s=>s.name)).toEqual(['WFS扣款异常','账单明细']);
 expect(workbook.worksheets[0].rowCount).toBe(3);
 expect(workbook.worksheets[0].getRow(2).getCell(3).type).toBe(ExcelJS.ValueType.String);
 expect(workbook.worksheets[0].getRow(2).getCell(7).value).toBe(10);
 expect(workbook.worksheets[1].rowCount).toBe(3);
});

it('derives export tenant and member scopes from authentication and returns a real xlsx attachment', async () => {
 const { default: express } = await import('express');
 const { returnsRouter } = await import('./returns.js');
 const calls: any[]=[];
 const app=express();app.use(returnsRouter({list:async()=>[],listPage:async(tenant,query)=>{calls.push([tenant,query]);return {rows:[],total:0} as any;},visibility:()=>({tenantId:'allowed',role:'member',storeIds:new Set(['s1']),skus:new Set(['s2:SKU'])})}));
 const server=app.listen(0);const address=server.address() as any;
 try {
   const response=await fetch(`http://localhost:${address.port}/returns/reconciliation/export?tenantId=other&sku=SKU&from=2026-11-01&to=2026-11-11&page=99`);
   expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('spreadsheetml');expect(response.headers.get('content-disposition')).toContain('.xlsx');
   expect(calls[0]).toEqual(['allowed',expect.objectContaining({page:1,sku:'SKU',from:'2026-11-01',to:'2026-11-11',storeIds:['s1'],skuScopes:[{storeId:'s2',sku:'SKU'}],reconciliation:true,responsibility:'wfs'})]);
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));expect(workbook.worksheets).toHaveLength(2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
