import ExcelJS from 'exceljs';
import {expect,it} from 'vitest';
import {inventoryReconWorkbook} from './inventory-recon-export.js';

it('exports only permitted SKU rows and sums opening inventory across warehouses',async()=>{
 const row={storeId:'s',storeName:'店铺',runId:'r',status:'completed',sku:'001',warehouse:'a',starting:3,ending:2};
 const buffer=await inventoryReconWorkbook('2026-09',[row,{...row,warehouse:'b',starting:5},{...row,sku:'private',starting:99},{...row,storeId:'hidden',storeName:'隐藏店铺'}],{role:'member',storeIds:new Set(),skus:new Set(['s:001'])});
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer as never);
 expect(wb.getWorksheet('月初库存汇总')!.getCell('B2').value).toBe('001');
 expect(wb.getWorksheet('月初库存汇总')!.getCell('E2').value).toBe(8);
 expect(wb.getWorksheet('仓库对账明细')!.rowCount).toBe(3);
 expect(wb.getWorksheet('报告覆盖')!.rowCount).toBe(2);
});

it('lists missing reports without treating them as zero inventory',async()=>{
 const buffer=await inventoryReconWorkbook('2026-08',[{storeId:'s',storeName:'店铺',status:'failed'}],{role:'admin',storeIds:new Set(),skus:new Set()});
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer as never);
 expect(wb.getWorksheet('月初库存汇总')!.rowCount).toBe(1);
 expect(wb.getWorksheet('报告覆盖')!.getCell('B2').value).toContain('失败');
});
