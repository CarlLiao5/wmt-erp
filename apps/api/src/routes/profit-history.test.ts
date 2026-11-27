import {afterEach,expect,it,vi} from 'vitest';
import ExcelJS from 'exceljs';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@walmart-erp/db',()=>({createDb:()=>({pool:{query}})}));
vi.mock('./profit-returns.js',()=>({loadProfitReturnRecords:async()=>[],returnSkusForMonth:()=>[],loadMonthlyReturnAdjustments:async()=>({rows:[],summary:{}}),returnAdjustmentWorkbook:vi.fn()}));
vi.mock('./product-images.js',()=>({mysqlProductImageResolver:()=>async()=>new Map()}));
vi.mock('./returns.js',()=>({mysqlProductChineseNameResolver:()=>async()=>new Map()}));
import {monthlyProfit} from './profit.js';
import {profitWorkbook} from './profit-export.js';
afterEach(()=>{vi.useRealTimers();query.mockReset();});
it('uses old SKU bills for unbilled WFS orders and carries the fees through product and order exports',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
 const sku='XMDK-TS-001';
 const line=(type:string,amount:string)=>({storeId:'s','Partner Item Id':sku,'Purchase Order #':'OLD-PO','Purchase Order line #':'1','Transaction Key':type,'Transaction Description':type==='fee'?'WFS Fulfillment fee':'Purchase','Transaction Type':type==='fee'?'Adjustment':'Sale','Amount Type':type==='fee'?'Fee/Reimbursement':type,'Transaction Posted Timestamp':'06/01/2020',Amount:amount,'Ship Qty':'1',Currency:'USD'});
 query.mockImplementation(async(sql:string)=>{
  if(sql.includes('FROM orders o JOIN order_lines'))return [[{orderId:'o',orderNumber:'NEW-PO',storeId:'s',sku,itemId:'123',lineNumber:'1',quantity:'2',revenue:'100',isWfs:1,orderedAt:new Date('2026-09-01T12:00:00Z')}]];
  if(sql.includes('FROM wfs_costs'))return [[{sku,purchase:'35',freight:'7',lastMile:null,commission:null}]];
  if(sql.includes('FROM recon_transactions'))return [[line('fee','-8'),line('Product Price','50'),line('Commission on Product','-5')]];
  return [[]];
 });
 const result=await monthlyProfit('t','2026-09',{exchangeRate:7,semDiscount:0});
 expect(result.orders[0]).toMatchObject({lastMile:16,commission:10});
 expect(result.products[0].fees).toMatchObject({lastMile:16,commission:10});
 expect(result.missingSkus.flatMap(r=>r.missing)).not.toContain('尾程');
 expect(result.missingSkus.flatMap(r=>r.missing)).not.toContain('佣金');
 vi.useRealTimers();
 const book=new ExcelJS.Workbook();await book.xlsx.load(await profitWorkbook('2026-09',{exchangeRate:7,semDiscount:0},result) as any);
 expect(book.getWorksheet('产品利润')!.getCell('H2').value).toBe(16);
 expect(book.getWorksheet('产品利润')!.getCell('I2').value).toBe(10);
 expect(book.getWorksheet('订单利润明细')!.getCell('G2').value).toBe(16);
 expect(book.getWorksheet('订单利润明细')!.getCell('H2').value).toBe(10);
 const paymentQuery=query.mock.calls.find(([sql])=>sql.includes('FROM recon_transactions'))!;
 expect(paymentQuery[0]).not.toContain('report_month>=?');
});

it('rejects previously saved profit results without the current calculation version',async()=>{
 const {isCurrentProfitSnapshot,PROFIT_CALCULATION_VERSION}=await import('./profit.js');
 expect(isCurrentProfitSnapshot({orders:[]})).toBe(false);
 expect(isCurrentProfitSnapshot(JSON.stringify({calculationVersion:'old'}))).toBe(false);
 expect(isCurrentProfitSnapshot({calculationVersion:PROFIT_CALCULATION_VERSION})).toBe(true);
 expect(isCurrentProfitSnapshot(JSON.stringify({calculationVersion:PROFIT_CALCULATION_VERSION}))).toBe(true);
});

it('exports unallocated advertising SKUs and amounts even when the month has no sales',async()=>{
 query.mockImplementation(async(sql:string)=>sql.includes('FROM ad_item_report')?[[{storeId:'s',sku:'UNSOLD',itemId:'999',spend:'12'}]]:sql.includes('FROM sem_performance_daily')?[[{storeId:'s',sku:'UNSOLD',itemId:'999',spend:'10'}]]:[[]]);
 const result=await monthlyProfit('t','2026-09',{exchangeRate:7,semDiscount:20});
 expect(result.advertisingReconciliation.onsite).toMatchObject({reported:12,allocated:0,unallocated:12});
 expect(result.advertisingReconciliation.sem.netUnallocated).toBe(8);
 expect(result.missingSkus).toEqual(expect.arrayContaining([expect.objectContaining({sku:'UNSOLD',advertisingSource:'SEM',advertisingDifference:10,advertisingNetDifference:8})]));
 const book=new ExcelJS.Workbook();await book.xlsx.load(await profitWorkbook('2026-09',{exchangeRate:7,semDiscount:20},result) as any);
 expect(book.getWorksheet('SKU缺失费用')!.getCell('H3').value).toBe('SEM');
 expect(book.getWorksheet('SKU缺失费用')!.getCell('J3').value).toBe(8);
 expect(book.getWorksheet('广告分摊核对')!.getCell('D3').value).toBe(10);
 const {missingCostsWorkbook}=await import('./profit.js');
 const missing=new ExcelJS.Workbook();await missing.xlsx.load(await missingCostsWorkbook('2026-09',result.missingSkus) as any);
 expect(missing.getWorksheet('SKU缺失费用')!.getCell('K3').value).toBe(8);
});
it('deducts zero-sale ads in monthly, product, daily and exported profit without creating an order',async()=>{
 query.mockImplementation(async(sql:string)=>sql.includes('FROM skus WHERE')?[[{storeId:'s',sku:'UNSOLD',itemId:'999',quantity:0}]]:sql.includes('FROM ad_item_report')?[[{storeId:'s',sku:'UNSOLD',itemId:'999',spend:'12',reportDate:'2026-09-03'}]]:sql.includes('FROM sem_performance_daily')?[[{storeId:'s',sku:null,itemId:'999',spend:'10',reportDate:'2026-09-04'}]]:[[]]);
 const result=await monthlyProfit('t','2026-09',{exchangeRate:7,semDiscount:20});
 expect(result.summary).toMatchObject({onsite:12,sem:8,profit:-20,orderCount:0,directAdvertisingDeduction:20});
 expect(result.orders).toEqual([]);expect(result.missingSkus).toEqual([]);
 expect(result.products[0]).toMatchObject({sku:'UNSOLD',quantity:0,revenue:0,profit:-20,fees:{onsite:12,sem:8}});
 expect(result.dailyProductProfits).toEqual(expect.arrayContaining([expect.objectContaining({date:'2026-09-03',profit:-12}),expect.objectContaining({date:'2026-09-04',profit:-8})]));
 const book=new ExcelJS.Workbook();await book.xlsx.load(await profitWorkbook('2026-09',{exchangeRate:7,semDiscount:20},result) as any);
 expect(book.getWorksheet('产品利润')!.getCell('N2').value).toBe(-20);
});
