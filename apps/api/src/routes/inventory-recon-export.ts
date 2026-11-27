import ExcelJS from 'exceljs';
import {createDb} from '@walmart-erp/db';
import type {OrderVisibility} from './orders.js';
import {canViewStore,canViewStoreSku} from './sku-visibility.js';

type Scope=Pick<OrderVisibility,'role'|'storeIds'|'skus'>;
type Row={storeId:string;storeName:string;runId?:string|null;status?:string|null;sku?:string|null;warehouse?:string;itemId?:string;itemName?:string;gtin?:string;starting?:number|string;ending?:number|string;difference?:number|string} & Partial<Record<typeof movements[number],number|string>>;
const movements=['received','sold','lost','found','undelivered','transferred','returned_to_seller','removed'] as const;

export async function inventoryReconRows(tenant:string,month:string):Promise<Row[]>{
 const [rows]=await createDb().pool.query(`
 WITH ranked AS (
  SELECT id,store_id,status,ROW_NUMBER() OVER(PARTITION BY store_id ORDER BY (status='completed') DESC,completed_at DESC,created_at DESC,id DESC) AS seq
  FROM wfs_inventory_recon_runs WHERE tenant_id=? AND report_month=?
 )
 SELECT s.id AS storeId,s.name AS storeName,r.id AS runId,r.status,d.sku,d.gtin,d.item_id AS itemId,d.item_name AS itemName,
 d.fulfillment_center AS warehouse,d.starting_quantity AS \`starting\`,d.final_quantity AS \`ending\`,d.difference,
 d.received,d.sold,d.lost,d.found,d.undelivered,d.transferred,d.returned_to_seller,d.removed
 FROM stores s LEFT JOIN ranked r ON BINARY r.store_id=BINARY s.id AND r.seq=1
 LEFT JOIN wfs_inventory_recon_rows d ON d.run_id=r.id AND d.tenant_id=? AND d.store_id=r.store_id AND r.status='completed'
 WHERE s.tenant_id=? AND s.environment='production'
 ORDER BY s.name,s.id,d.sku,d.fulfillment_center`,[tenant,month,tenant,tenant]);
 return rows as Row[];
}

export async function inventoryReconWorkbook(month:string,rows:Row[],scope:Scope){
 const wb=new ExcelJS.Workbook();
 const sheets=[
  ['月初库存汇总',['店铺','SKU','Item ID','产品名称','月初库存','月末库存','仓库数','库存差额','报告月份']],
  ['仓库对账明细',['店铺','SKU','Item ID','产品名称','GTIN','仓库','月初库存','入库','销售','丢失','找回','未送达','转仓','退回卖家','移除','月末库存','库存差额','报告月份']],
  ['报告覆盖',['店铺','报告状态','可见明细数','报告月份']],
 ] as const;
 for(const [name,headers] of sheets){const sheet=wb.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});sheet.columns=headers.map(header=>({header,width:header==='产品名称'?42:20}));}
 const [summary,detail,coverage]=wb.worksheets;
 const products=new Map<string,{row:Row;starting:number;ending:number;difference:number;warehouses:number}>();
 const reports=new Map<string,{row:Row;count:number}>();
 for(const row of rows){
  if(!canViewStore(scope,row.storeId))continue;
  const report=reports.get(row.storeId)??{row,count:0};reports.set(row.storeId,report);
  if(row.status!=='completed'||!row.sku||!canViewStoreSku(scope,row.storeId,row.sku))continue;
  report.count++;
  const key=JSON.stringify([row.storeId,row.sku]);
  const p=products.get(key)??{row,starting:0,ending:0,difference:0,warehouses:0};
  const starting=Number(row.starting??0),ending=Number(row.ending??0),difference=Number(row.difference??0);
  p.starting+=starting;p.ending+=ending;p.difference+=difference;p.warehouses++;products.set(key,p);
  detail!.addRow([row.storeName,row.sku,row.itemId,row.itemName,row.gtin,row.warehouse,starting,...movements.map(field=>Number(row[field]??0)),ending,difference,month]);
 }
 for(const {row,starting,ending,warehouses,difference} of products.values())summary!.addRow([row.storeName,row.sku,row.itemId,row.itemName,starting,ending,warehouses,difference,month]);
 for(const {row,count} of reports.values())coverage!.addRow([row.storeName,row.status==='completed'?'已入库':row.status==='failed'?'获取失败':row.status?'待入库':'无报告',count,month]);
 for(const sheet of wb.worksheets){sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A5F'}};sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:sheet.columnCount}};}
 return Buffer.from(await wb.xlsx.writeBuffer());
}
