import { expect, it } from 'vitest';
import { calculateProfit } from './profit.js';

it('multiplies unit costs by quantity, retains real zero fees, and discounts allocated SEM', () => {
  expect(calculateProfit({
    revenue: 100, quantity: 2, purchase: 35, freight: 7, lastMile: 0,
    commission: 8, onsite: 2, sem: 4, its: 1, exchangeRate: 7, semDiscount: 50,
  })).toMatchObject({purchase: 10, freight: 2, lastMile: 0, commission: 8, onsite: 4, sem: 4, its: 2, profit: 70});
});

it('marks a result incomplete when a cost input is missing', () => {
  expect(calculateProfit({
    revenue: 100, quantity: 1, purchase: null, freight: 7, lastMile: 0,
    commission: 8, onsite: 0, sem: 0, its: null, exchangeRate: 7, semDiscount: 0,
  })).toMatchObject({profit: 91, missing: ['采购', 'ITS']});
});

import { actualPaymentFees } from './profit.js';
it('deduplicates payment pages and preserves actual zero while isolating stores',()=>{
 const row={'Partner Item Id':' sku ','Purchase Order #':'PO','Purchase Order line #':'1','Transaction Key':'t','Transaction Description':'Purchase','Transaction Type':'Sale','Amount Type':'Commission on Product',Amount:'0',Currency:'USD'};
 const pages=[{storeId:'a',payload:{reportData:[row,row,{...row,'Transaction Key':'tail','Transaction Description':'WFS Fulfillment fee',Amount:'-7'}]}},{storeId:'b',payload:{reportData:[{...row,Amount:'-3'}]}}];
 expect([...actualPaymentFees(pages).values()]).toEqual([{commission:0,lastMile:7},{commission:3}]);
});

import { summarizeMissingSkus, missingCostsWorkbook } from './profit.js';
import ExcelJS from 'exceljs';
it('groups only incomplete lines by store/SKU and counts distinct affected orders',()=>{
 const base={storeId:'s1',sku:'abc',itemId:'123',orderId:'o1',quantity:2,revenue:20,missing:['采购']};
 const rows=summarizeMissingSkus([base,{...base,quantity:1,missing:['ITS']},{...base,orderId:'o2',missing:[]},{...base,storeId:'s2'}]);
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({sku:'ABC',orderCount:1,quantity:3,revenue:40,missing:['采购','ITS']});
 expect(rows[1]).toMatchObject({storeId:'s2',orderCount:1,quantity:2});
});
it('exports an XLSX with month, SKU and explicit missing categories',async()=>{
 const rows=summarizeMissingSkus([{storeId:'store',sku:'ABC',itemId:'123',orderId:'o',quantity:2,revenue:100,missing:['采购','ITS']}]);
 const buffer=await missingCostsWorkbook('2026-11',rows);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as any);
 const sheet=workbook.worksheets[0]!;
 expect(sheet.rowCount).toBe(2);
 expect(sheet.getRow(2).getCell(1).value).toBe('2026-11');
 expect(sheet.getRow(2).getCell(3).value).toBe('ABC');
 expect(sheet.getRow(2).getCell(5).value).toBe('采购、ITS');
});

import { applyMonthlyReturns } from './profit.js';
it('deducts seller returns directly from canonical gross profit and order profits, including prior-month returns in monthly total',()=>{
 const orders=[{storeId:'s',orderNumber:'o',profit:100}];
 const result=applyMonthlyReturns(orders,{profit:100},[{storeId:'s',orderNumber:'o',netDeduction:20},{storeId:'s',orderNumber:'old',netDeduction:30}]);
 expect(result.summary).toMatchObject({profit:50,profitBeforeReturns:100,returnDeduction:50,priorOrderReturnDeduction:30});
 expect(result.orders[0]).toMatchObject({profit:80,profitBeforeReturns:100,returnDeduction:20});
 expect(orders[0].profit).toBe(100);
});

import { resolveOrderFees } from './profit.js';
it('fills only unmatched fees and preserves zero actual and manual values', () => {
  expect(resolveOrderFees({ commission: 0 }, { lastMile: '3.25', commission: '15' }, 2, 100, null, 7))
    .toEqual({ lastMile: 6.5, commission: 0 });
  expect(resolveOrderFees({ lastMile: 0 }, { lastMile: '3.25', commission: '15' }, 2, 100, null, 7))
    .toEqual({ lastMile: 0, commission: 15 });
  expect(resolveOrderFees(undefined, { lastMile: '0', commission: null }, 2, 100, null, 7))
    .toEqual({ lastMile: 0, commission: 7 });
  expect(resolveOrderFees(undefined, undefined, 2, 100, null, null))
    .toEqual({ lastMile: null, commission: null });
});

import { createProductProfitRollup } from './profit.js';
it('reconciles cross-month returns and keeps the same SKU in different stores separate', () => {
  const products = createProductProfitRollup();
  products.addSale('a', 'sku', 2, 100, 35);
  products.addSale('b', 'SKU', 1, 50, 18);
  products.addReturn('a', 'SKU', 10);
  products.addReturn('a', 'old-sku', 8);
  expect(products.rows()).toMatchObject([
    {storeId:'a',sku:'SKU',quantity:2,revenue:100,returnDeduction:10,profit:25},
    {storeId:'b',sku:'SKU',quantity:1,profit:18},
    {storeId:'a',sku:'OLD-SKU',quantity:0,revenue:0,profit:-8},
  ]);
});
