import {expect,it} from 'vitest';
import {calculateReturnAdjustment,buildReturnAdjustments,returnAdjustmentWorkbook} from './profit-returns.js';
import ExcelJS from 'exceljs';
const base={quantity:1,refundActual:null,refundRecord:100,originalRevenue:200,originalQuantity:2,commissionActual:null,originalCommission:30,commissionRate:.1,returnFees:0,compensation:0,unsellableUnitCost:20};
it('prefers actual commission, then proportional original commission, then estimated SKU rate; retains actual zero',()=>{
 expect(calculateReturnAdjustment({...base,commissionActual:12})).toMatchObject({commissionCredit:12,commissionSource:'账单实际（分摊）',netDeduction:88});
 expect(calculateReturnAdjustment({...base,commissionActual:0})).toMatchObject({commissionCredit:0,netDeduction:100});
 expect(calculateReturnAdjustment(base)).toMatchObject({commissionCredit:15,commissionSource:'原订单佣金预估',netDeduction:85,unsellableCost:20});
 expect(calculateReturnAdjustment({...base,originalCommission:null})).toMatchObject({commissionCredit:10,commissionSource:'SKU佣金率预估'});
 expect(calculateReturnAdjustment({...base,originalCommission:null,commissionRate:null}).missing).toContain('返还佣金');
});
it('does not deduct unsellable cost again, handles actual refunds and partial returns',()=>{
 expect(calculateReturnAdjustment({...base,refundActual:80,commissionActual:12,returnFees:5,compensation:2})).toMatchObject({refund:80,netDeduction:71,unsellableCost:20});
});
const record={id:'r1',returnId:'ret1',returnItemId:'line1',storeId:'s',orderNumber:'po',customerOrderId:null,sku:'SKU',quantity:1,amount:100,currency:'USD',status:'COMPLETED',refundStatus:'REFUND_COMPLETED',responsibility:'Seller',returnedAt:'2026-11-01T08:00:00Z',updatedAt:'2026-11-02T00:00:00Z'};
const sources={originals:[{storeId:'s',orderNumber:'po',customerOrderId:null,sku:'SKU',quantity:2,revenue:200,orderedAt:'2026-10-01T08:00:00Z'}],payments:[],averages:[{sku:'SKU',rate:.15}],costs:[{storeId:'s',sku:'SKU',unitCost:20}]};
it('filters responsibility and refund state, deduplicates and includes historical sales in a no-sales month',()=>{
 const result=buildReturnAdjustments('2026-11',[record,{...record,id:'duplicate'},{...record,id:'w',returnId:'w',responsibility:'Walmart'},{...record,id:'p',returnId:'p',refundStatus:'REFUND_INITIATED'},{...record,id:'c',returnId:'c',refundStatus:'CANCELLED'}],sources);
 expect(result.rows).toHaveLength(1);
 expect(result.rows[0]).toMatchObject({saleMonth:'2026-10',commissionCredit:15,netDeduction:85});
 expect(result.summary).toMatchObject({count:1,pending:1,excluded:1,cancelled:1,netDeduction:85});
});
it('allocates a shared actual bill once across months and responsibilities instead of repeating full refunds',()=>{
 const payment={id:'t1',storeId:'s',purchaseOrderId:'po',customerOrderId:null,sku:'SKU',amount:-200,currency:'USD',transactionType:'Refund',amountType:'Product Price',description:'Return Refund'};
 const result=buildReturnAdjustments('2026-11',[record,{...record,id:'r2',returnId:'ret2',responsibility:'Walmart',returnedAt:'2026-10-15T08:00:00Z'}],{...sources,payments:[payment,payment,{...payment,id:'t2',amount:30,amountType:'Commission on Product'}]});
 expect(result.rows).toHaveLength(1);
 expect(result.rows[0]).toMatchObject({refund:100,commissionCredit:15,netDeduction:85});
});
it('uses Pacific return month boundaries and does not use initiated status as completed',()=>{
 const result=buildReturnAdjustments('2026-11',[{...record,returnedAt:'2026-11-01T06:59:00Z'},{...record,id:'pending',returnId:'pending',refundStatus:'REFUND_INITIATED'}],sources);
 expect(result.rows).toHaveLength(0);expect(result.summary.pending).toBe(1);
});
it('exports return adjustments including estimate sources and missing values',async()=>{
 const result=buildReturnAdjustments('2026-11',[record],sources);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await returnAdjustmentWorkbook('2026-11',result.rows) as any);
 expect(workbook.worksheets[0]!.rowCount).toBe(2);
 expect(workbook.worksheets[0]!.getRow(2).values).toContain('SKU佣金率预估');
});

it('uses sale commission for partial returns even when the refund statement has not arrived; isolates stores',()=>{
 const sale={id:'sale',storeId:'s',purchaseOrderId:'po',customerOrderId:null,sku:'SKU',amount:-30,currency:'USD',transactionType:'Sale',amountType:'Commission on Product',description:'Purchase'};
 const result=buildReturnAdjustments('2026-11',[record],{...sources,payments:[sale,{...sale,id:'foreign',storeId:'other',amount:-80}]});
 expect(result.rows[0]).toMatchObject({commissionCredit:15,commissionSource:'原订单佣金预估',netDeduction:85});
 const actual=buildReturnAdjustments('2026-11',[record],{...sources,payments:[sale,{...sale,id:'refund',transactionType:'Refund',amount:12,description:'Return Refund'}]});
 expect(actual.rows[0]).toMatchObject({commissionCredit:12,commissionSource:'账单实际（分摊）',netDeduction:88});
});
it('recognizes the normalized ISSUED refund state',()=>{
 expect(buildReturnAdjustments('2026-11',[{...record,status:'REFUNDED',refundStatus:'ISSUED'}],sources).rows).toHaveLength(1);
});
it('preserves distinct equal-price SKU lines within a return and merges legacy ordinal aliases',()=>{
 const a={...record,id:'a',returnItemId:'1'},b={...record,id:'b',returnItemId:'2'};
 const result=buildReturnAdjustments('2026-11',[a,b,{...a,id:'canonical',returnItemId:'ret1_L1'}],sources);
 expect(result.rows).toHaveLength(2);expect(result.summary.quantity).toBe(2);expect(result.summary.refund).toBe(200);
});
it('uses payment aliases to allocate once even when original orders are missing',()=>{
 const payment={id:'refund',storeId:'s',purchaseOrderId:'po',customerOrderId:'customer',sku:'SKU',amount:-200,currency:'USD',transactionType:'Refund',amountType:'Product Price',description:'Return Refund'};
 const result=buildReturnAdjustments('2026-11',[record,{...record,id:'otherMonth',returnId:'otherReturn',orderNumber:'customer',returnedAt:'2026-10-10T08:00:00Z'}],{...sources,originals:[],payments:[payment]});
 expect(result.rows[0]).toMatchObject({refund:100});
});
it('treats stored UTC timestamps without offsets independently of the server timezone',()=>{
 const previous=process.env.TZ;process.env.TZ='America/New_York';
 try{expect(buildReturnAdjustments('2026-11',[{...record,returnedAt:'2026-11-01 06:59:00'}],sources).rows).toHaveLength(0);}
 finally{if(previous==null)delete process.env.TZ;else process.env.TZ=previous;}
});
