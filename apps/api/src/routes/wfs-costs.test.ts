import express from 'express';
import ExcelJS from 'exceljs';
import {expect,it,vi} from 'vitest';
import {hashPassword} from '../auth/passwords.js';
import {authRouter} from './auth.js';
import {parseWfsCosts,wfsCostsRouter} from './wfs-costs.js';

it('imports only the explicitly selected sheet, retains identifiers and accepts missing descriptive metadata',async()=>{
 const w=new ExcelJS.Workbook();
 w.addWorksheet('其他').addRow(['不应读取']);
 const s=w.addWorksheet('4-6月');
 s.addRow(['MSKU','UPC','Item ID','品名','出库采购单价','出库头程单价']);
 s.addRow(['sku-a','001234','1234567890123','产品',44,10.8780388291852]);
 s.addRow(['SKU-B','','','',0,0]);
 const buffer=Buffer.from(await w.xlsx.writeBuffer());
 const rows=await parseWfsCosts(buffer,'4-6月');
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({sku:'SKU-A',upc:'001234',purchaseCost:'44',freightCost:'10.8780388291852'});
 expect(rows[1]).toMatchObject({sku:'SKU-B',productName:'',purchaseCost:'0'});
 await expect(parseWfsCosts(buffer,'缺少')).rejects.toThrow('未找到工作表');
 s.addRow(['SKU-A','','','',1,1]);
 await expect(parseWfsCosts(Buffer.from(await w.xlsx.writeBuffer()),'4-6月')).rejects.toThrow('SKU 重复');
});
it('rejects non-admin read, manual edits and spreadsheet imports before accessing storage',async()=>{
 vi.stubEnv('MYSQL_URL','');
 const passwordHash=await hashPassword('test-password');
 const app=express();app.use(express.json());app.use(authRouter(async()=>({id:'user',tenantId:'t',role:'member',passwordHash})));app.use(wfsCostsRouter());
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('port');
  const base='http://127.0.0.1:'+address.port;
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'staff@test.invalid',password:'test-password'})});
  const token=(await login.json()).data.token;
  for(const [path,method] of [['','GET'],['','POST'],['/import?sheet=4-6月','POST'],['/template','GET']]){
   const response=await fetch(base+'/wfs-costs'+path,{method,headers:{Authorization:'Bearer '+token}});
   expect(response.status).toBe(403);
  }
  expect((await fetch(base+'/wfs-costs')).status).toBe(401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();}
});

it('exports a blank SKU template that can be filled and reimported',async()=>{
 const {costTemplate}=await import('./wfs-costs.js');
 const buffer=await costTemplate();
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
 const sheet=workbook.getWorksheet('成本表')!;
 expect(sheet.getRow(1).values).toEqual([undefined,'SKU','UPC','Item ID','品名','出库采购单价','出库头程单价','手填尾程（USD/件）','手填佣金率（%）']);
 expect(sheet.rowCount).toBe(1);
 sheet.addRow(['ABC','','','',10,2,0,15]);
 sheet.addRow(['DEF','','','',10,2,3.25,0.125]).getCell(8).numFmt='0.00%';
 sheet.addRow(['GHI','','','',10,2]);
 expect(await parseWfsCosts(Buffer.from(await workbook.xlsx.writeBuffer()),'成本表')).toMatchObject([{sku:'ABC',purchaseCost:'10',freightCost:'2',manualLastMile:'0',manualCommissionPercent:'15'},{sku:'DEF',manualLastMile:'3.25',manualCommissionPercent:'12.500000'},{sku:'GHI'}]);
 const parsed = await parseWfsCosts(Buffer.from(await workbook.xlsx.writeBuffer()),'成本表');
 expect(parsed[2]).not.toHaveProperty('manualCommissionPercent');
});

it('fills missing metadata by exact normalized SKU, keeps manual values, and refuses conflicting catalog values',async()=>{
 const {fillCostMetadata}=await import('./wfs-costs.js');
 const costs=[{sku:'abc',upc:'',itemId:'',productName:'手填名称',purchaseCost:'10',freightCost:'2'}];
 const catalog=[
 {sku:' ABC ',upc:'001234',itemId:'123',productName:'目录名称'},
 {sku:'ABC',upc:'001234',itemId:'456',productName:'目录名称'},
 {sku:'AB',upc:'999',itemId:'999',productName:'错误匹配'},
 ];
 expect(fillCostMetadata(costs,catalog)).toEqual([{...costs[0],upc:'001234'}]);
});

it('accepts blank import costs as unchanged fields and preserves explicit zero',async()=>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('任意工作表');
 sheet.addRow(['SKU','UPC','Item ID','品名','出库采购单价','出库头程单价','手填尾程（USD/件）','手填佣金率（%）']);
 sheet.addRow([' sku-a ','','','','','',0,'0%']);
 sheet.addRow(['SKU-B','','','','0','0','','']);
 const rows=await parseWfsCosts(Buffer.from(await workbook.xlsx.writeBuffer()),'任意工作表');
 expect(rows[0]).toMatchObject({sku:'SKU-A',purchaseCost:null,freightCost:null,manualLastMile:'0',manualCommissionPercent:'0'});
 expect(rows[1]).toMatchObject({purchaseCost:'0',freightCost:'0'});
 expect(rows[1]).not.toHaveProperty('manualLastMile');
});

it('merges imports by normalized SKU, keeping every blank field and applying supplied values including zero',async()=>{
 const {mergeCostImport}=await import('./wfs-costs.js');
 const existing=[{sku:' SKU-A ',upc:'00123',itemId:'123',productName:'原品名',purchaseCost:'45.25',freightCost:'8.75'}];
 const blank={sku:'sku-a',upc:'',itemId:'',productName:'',purchaseCost:null,freightCost:null};
 expect(mergeCostImport([blank],existing)).toEqual([{...blank,sku:'SKU-A',upc:'00123',itemId:'123',productName:'原品名',purchaseCost:'45.25',freightCost:'8.75'}]);
 expect(mergeCostImport([{...blank,productName:'新名称',purchaseCost:'0',freightCost:'0',manualLastMile:'0',manualCommissionPercent:'0'}],existing)[0]).toMatchObject({productName:'新名称',purchaseCost:'0',freightCost:'0',manualLastMile:'0',manualCommissionPercent:'0',upc:'00123'});
 expect(()=>mergeCostImport([{...blank,sku:'NEW'}],existing)).toThrow('NEW');
 expect(mergeCostImport([{...blank,sku:'NEW',purchaseCost:'10'}],existing)[0]).toMatchObject({sku:'NEW',purchaseCost:'10',freightCost:null});
});
