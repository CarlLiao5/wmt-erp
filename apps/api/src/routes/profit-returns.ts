import ExcelJS from 'exceljs';
import {createDb} from '@walmart-erp/db';

type ReturnInput={quantity:number|null;refundActual:number|null;refundRecord:number|null;originalRevenue:number|null;originalQuantity:number|null;commissionActual:number|null;originalCommission:number|null;commissionRate:number|null;returnFees:number;compensation:number;unsellableUnitCost:number|null};
const numeric=(value:unknown):number|null=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
const norm=(value:unknown)=>String(value??'').trim().toUpperCase();
const identity=(store:string,order:string,sku:string)=>JSON.stringify([store,order.trim(),norm(sku)]);
const product=(store:string,sku:string)=>JSON.stringify([store,norm(sku)]);
export function calculateReturnAdjustment(input:ReturnInput){
 const missing:string[]=[];
 const ratio=input.quantity!=null&&input.originalQuantity!=null&&input.originalQuantity>0?Math.min(1,input.quantity/input.originalQuantity):null;
 const refund=input.refundActual??input.refundRecord??(ratio!=null&&input.originalRevenue!=null?input.originalRevenue*ratio:null);
 const refundSource=input.refundActual!=null?'账单实际（分摊）':input.refundRecord!=null?'退货记录预估':'原订单金额预估';
 const commissionCredit=input.commissionActual??(input.originalCommission!=null&&ratio!=null?input.originalCommission*ratio:null)??(refund!=null&&input.commissionRate!=null?refund*input.commissionRate:null);
 const commissionSource=input.commissionActual!=null?'账单实际（分摊）':input.originalCommission!=null&&ratio!=null?'原订单佣金预估':'SKU佣金率预估';
 if(refund==null)missing.push('商品退款');
 if(commissionCredit==null)missing.push('返还佣金');
 if(input.quantity==null)missing.push('退货数量');
 const unsellableCost=input.unsellableUnitCost!=null&&input.quantity!=null?input.unsellableUnitCost*input.quantity:null;
 if(unsellableCost==null)missing.push('不可售商品成本');
 return {refund:refund??0,refundSource,commissionCredit:commissionCredit??0,commissionSource,returnFees:input.returnFees,compensation:input.compensation,
  unsellableCost,netDeduction:(refund??0)+input.returnFees-(commissionCredit??0)-input.compensation,missing,
  estimated:input.refundActual==null||input.commissionActual==null};
}
export type ProfitReturn={id:string;returnId:string|null;returnItemId:string|null;storeId:string;orderNumber:string;customerOrderId:string|null;sku:string;quantity:number|null;amount:number|null;currency:string|null;status:string;refundStatus:string|null;responsibility:string|null;returnedAt:string|null;updatedAt:string|null};
type Original={storeId:string;orderNumber:string;customerOrderId:string|null;sku:string;quantity:number|null;revenue:number|null;orderedAt:string|null};
type Payment={id:string;storeId:string;purchaseOrderId:string|null;customerOrderId:string|null;sku:string;amount:number;currency:string;transactionType:string|null;amountType:string|null;description:string};
type Sources={originals:Original[];payments:Payment[];averages:Array<{sku:string;rate:number}>;costs:Array<{storeId:string;sku:string;unitCost:number|null}>};
const monthFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'});
const dateMonth=(value:string|null)=>{if(!value)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.slice(0,7);const utc=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)?value.replace(' ','T')+'Z':value;const d=new Date(utc);if(!Number.isFinite(d.getTime()))return '';const p=monthFormatter.formatToParts(d);return p.find(x=>x.type==='year')!.value+'-'+p.find(x=>x.type==='month')!.value;};
const cancelled=(r:ProfitReturn)=>[norm(r.status),norm(r.refundStatus)].some(s=>/CANCEL|FAILED|REJECT/.test(s));
const refunded=(r:ProfitReturn)=>!cancelled(r)&&(r.refundStatus?.trim()?['REFUNDED','REFUND_COMPLETED','COMPLETED','SUCCESS','REFUND_ISSUED','ISSUED'].includes(norm(r.refundStatus)):['REFUNDED','COMPLETED','REFUND_COMPLETED'].includes(norm(r.status)));
const seller=(r:ProfitReturn)=>['SELLER','SELLER KEEP-IT'].includes(norm(r.responsibility));
function deduplicate(records:ProfitReturn[],orderIdentity=(r:ProfitReturn)=>r.orderNumber){
 const parents=new Map<string,ProfitReturn[]>();
 for(const row of records){const key=JSON.stringify([row.storeId,row.returnId||row.id,orderIdentity(row),norm(row.sku)]);const list=parents.get(key)??[];list.push(row);parents.set(key,list);}
 const result:ProfitReturn[]=[];
 for(const rows of parents.values()){
  const canonicalIds=[...new Set(rows.map(r=>r.returnItemId??'').filter(id=>/_L\d+$/i.test(id)))];
  const ordinalIds=[...new Set(rows.map(r=>r.returnItemId??'').filter(id=>/^\d+$/.test(id)))];
  const lineIdentity=(r:ProfitReturn)=>{
   const id=(r.returnItemId??'').trim(),suffix=/_L(\d+)$/i.exec(id)?.[1];
   if(suffix)return 'line:'+Number(suffix);
   if(/^\d+$/.test(id)){
    if(canonicalIds.some(value=>Number(/_L(\d+)$/i.exec(value)![1])===Number(id)))return 'line:'+Number(id);
    // Historical API array indices differ from the order line suffix; bridge only an unambiguous one-to-one pair.
    if(canonicalIds.length===1&&ordinalIds.length===1)return 'line:'+Number(/_L(\d+)$/i.exec(canonicalIds[0]!)![1]);
    return 'line:'+Number(id);
   }
   return id?'item:'+id:'';
  };
  const explicit=[...new Set(rows.map(lineIdentity).filter(Boolean))],grouped=new Map<string,ProfitReturn>();
  for(const r of rows){
   const key=lineIdentity(r)||(explicit.length===1?explicit[0]!:'legacy:'+String(r.amount));
   const previous=grouped.get(key);
   const canonical=Number(/_l/i.test(r.returnItemId??'')),oldCanonical=Number(/_l/i.test(previous?.returnItemId??''));
   if(!previous||canonical>oldCanonical||(canonical===oldCanonical&&(r.updatedAt??'')>(previous.updatedAt??'')))grouped.set(key,r);
  }
  result.push(...grouped.values());
 }
 return result;
}
export function buildReturnAdjustments(month:string,records:ProfitReturn[],sources:Sources){
 // Resolve aliases from both normalized orders and bills; each transaction belongs to one allocation group.
 const parents=new Map<string,string>();
 const find=(key:string):string=>{const parent=parents.get(key);if(!parent){parents.set(key,key);return key;}if(parent===key)return key;const root=find(parent);parents.set(key,root);return root;};
 const link=(store:string,sku:string,a:string|null,b:string|null)=>{if(a&&b){const x=find(identity(store,a,sku)),y=find(identity(store,b,sku));if(x!==y)parents.set(y,x);}};
 for(const row of records)link(row.storeId,row.sku,row.orderNumber,row.customerOrderId);
 for(const row of sources.originals)link(row.storeId,row.sku,row.orderNumber,row.customerOrderId);
 for(const row of sources.payments)link(row.storeId,row.sku,row.purchaseOrderId,row.customerOrderId);
 const rowKey=(r:ProfitReturn)=>find(identity(r.storeId,r.orderNumber||r.customerOrderId||r.id,r.sku));
 const deduped=deduplicate(records,rowKey),originals=new Map<string,Original[]>();
 for(const row of sources.originals){const key=find(identity(row.storeId,row.orderNumber,row.sku)),list=originals.get(key)??[];list.push(row);originals.set(key,list);}
 const canonical=(r:ProfitReturn)=>{const key=rowKey(r);return {key,matches:originals.get(key)??[]};};
 const groups=new Map<string,ProfitReturn[]>();
 for(const row of deduped.filter(r=>refunded(r)&&norm(r.currency??'USD')==='USD')){
  const key=rowKey(row),group=groups.get(key)??[];group.push(row);groups.set(key,group);
 }
 const payments=new Map<string,Payment[]>(),seen=new Set<string>();
 for(const row of sources.payments){
  if(norm(row.currency)!=='USD'||seen.has(row.id)||(!row.purchaseOrderId&&!row.customerOrderId))continue;seen.add(row.id);
  const key=find(identity(row.storeId,row.purchaseOrderId||row.customerOrderId!,row.sku)),items=payments.get(key)??[];items.push(row);payments.set(key,items);
 }
 const rates=new Map(sources.averages.map(r=>[norm(r.sku),r.rate]));
 const costs=new Map(sources.costs.map(r=>[product(r.storeId,r.sku),r.unitCost]));
 const rows:Array<ProfitReturn&ReturnType<typeof calculateReturnAdjustment>&{saleMonth:string;canonicalOrderNumber:string;billAllocated:boolean;feeStatus:string}>=[];
 const summary={count:0,quantity:0,pending:0,cancelled:0,excluded:0,nonUsd:0,refund:0,commissionCredit:0,returnFees:0,compensation:0,netDeduction:0,unsellableCost:0,incomplete:0,estimated:0};
 for(const r of deduped.filter(r=>dateMonth(r.returnedAt)===month)){
  if(!seller(r)){summary.excluded++;continue;}
  if(cancelled(r)){summary.cancelled++;continue;}
  if(!refunded(r)){summary.pending++;continue;}
  if(norm(r.currency??'USD')!=='USD'){summary.nonUsd++;continue;}
  const {key,matches}=canonical(r);
  const siblings=groups.get(key)??[r],totalWeight=siblings.reduce((n,r)=>n+(r.quantity&&r.quantity>0?r.quantity:1),0);
  const share=(r.quantity&&r.quantity>0?r.quantity:1)/totalWeight;
  const ledger=payments.get(key)??[];
  const select=(test:(p:Payment)=>boolean)=>ledger.filter(test);
  const sum=(items:Payment[])=>items.reduce((n,p)=>n+p.amount,0);
  const refunds=select(p=>norm(p.transactionType)==='REFUND'&&norm(p.amountType)==='PRODUCT PRICE');
  const credits=select(p=>norm(p.transactionType)==='REFUND'&&/COMMISSION/.test(norm(p.amountType)));
  const commissions=select(p=>norm(p.transactionType)==='SALE'&&norm(p.amountType)==='COMMISSION ON PRODUCT');
  const fees=select(p=>norm(p.transactionType)!=='REFUND'&&/RETURN.*(?:FEE|CHARGE)/i.test(p.description));
  const compensations=select(p=>/REIMBURSEMENT|COMPENSATION/i.test(p.description)&&p.amount>0);
  const quantity=matches.length&&matches.every(x=>x.quantity!=null)?matches.reduce((n,o)=>n+o.quantity!,0):null;
  const revenue=matches.length&&matches.every(x=>x.revenue!=null)?matches.reduce((n,o)=>n+o.revenue!,0):null;
  const calculated=calculateReturnAdjustment({quantity:r.quantity&&r.quantity>0?r.quantity:null,refundActual:refunds.length?-sum(refunds)*share:null,refundRecord:r.amount,
   originalRevenue:revenue,originalQuantity:quantity,commissionActual:credits.length?sum(credits)*share:null,originalCommission:commissions.length?-sum(commissions):null,
   commissionRate:rates.get(norm(r.sku))??null,returnFees:-sum(fees)*share,compensation:sum(compensations)*share,unsellableUnitCost:costs.get(product(r.storeId,r.sku))??null});
  if(!matches.length)calculated.missing.push('原订单关联');
  if(!r.orderNumber||!r.sku)calculated.missing.push('订单/SKU关联');
  if(quantity!=null&&siblings.reduce((n,r)=>n+(r.quantity??0),0)>quantity)calculated.missing.push('累计退货数量超过订单');
  const row={...r,...calculated,canonicalOrderNumber:matches[0]?.orderNumber??r.orderNumber,saleMonth:dateMonth(matches[0]?.orderedAt??null),billAllocated:true,feeStatus:fees.length?'账单实际（分摊）':'未见退货费用，暂按0'};
  rows.push(row);summary.count++;summary.quantity+=r.quantity??0;
  for(const field of ['refund','commissionCredit','returnFees','compensation','netDeduction'] as const)summary[field]+=row[field];
  summary.unsellableCost+=row.unsellableCost??0;if(row.missing.length)summary.incomplete++;if(row.estimated)summary.estimated++;
 }
 return {rows,summary};
}
export async function loadProfitReturnRecords(tenant:string){
 const {pool}=createDb();
 const [result]=await pool.query(`SELECT id,return_order_id AS returnId,return_order_item_id AS returnItemId,store_id AS storeId,
 COALESCE(NULLIF(order_number,''),SUBSTRING(order_id,CHAR_LENGTH(store_id)+2)) AS orderNumber,customer_order_id AS customerOrderId,
 COALESCE(sku,'') AS sku,quantity,amount,currency,status,refund_status AS refundStatus,refund_covered_by AS responsibility,returned_at AS returnedAt,updated_at AS updatedAt
 FROM return_records WHERE tenant_id=?`,[tenant]);
 return (result as ProfitReturn[]).map(r=>({...r,quantity:numeric(r.quantity),amount:numeric(r.amount),updatedAt:r.updatedAt?new Date(r.updatedAt).toISOString():null}));
}
export function returnSkusForMonth(month:string,records:ProfitReturn[]){
 return [...new Set(records.filter(r=>dateMonth(r.returnedAt)===month&&seller(r)&&refunded(r)&&norm(r.currency??'USD')==='USD').map(r=>norm(r.sku)).filter(Boolean))];
}
export async function loadMonthlyReturnAdjustments(tenant:string,month:string,exchangeRate:number,options:{records?:ProfitReturn[];averages?:Sources['averages']}={}){
 const {pool}=createDb();
 const records=options.records??await loadProfitReturnRecords(tenant);
 const current=records.filter(r=>dateMonth(r.returnedAt)===month&&seller(r)&&refunded(r)&&norm(r.currency??'USD')==='USD');
 if(!current.length)return buildReturnAdjustments(month,records,{originals:[],payments:[],averages:[],costs:[]});
 const skus=[...new Set(current.map(r=>norm(r.sku)).filter(Boolean))];
 const storeOrders=new Map<string,Set<string>>();
 for(const r of current){const orders=storeOrders.get(r.storeId)??new Set<string>();for(const value of [r.orderNumber,r.customerOrderId])if(value)orders.add(value);storeOrders.set(r.storeId,orders);}
 const originals:Original[]=[],payments:Payment[]=[];
 for(const [store,values]of storeOrders){
  const numbers=[...values];if(!numbers.length)continue;
  const o=await pool.query(`SELECT o.external_id AS orderNumber,o.customer_order_id AS customerOrderId,o.store_id AS storeId,s.external_id AS sku,
    l.quantity,l.line_amount AS revenue,o.ordered_at AS orderedAt FROM orders o JOIN order_lines l ON l.order_id=o.id AND l.tenant_id=o.tenant_id AND l.store_id=o.store_id
    JOIN skus s ON s.id=l.sku_id AND s.tenant_id=o.tenant_id AND s.store_id=o.store_id
    JOIN (
     SELECT id FROM orders FORCE INDEX(orders_store_external_unique) WHERE tenant_id=? AND store_id=? AND external_id IN (?)
     UNION
     SELECT id FROM orders FORCE INDEX(orders_customer_order_idx) WHERE tenant_id=? AND store_id=? AND customer_order_id IN (?)
    ) selected ON selected.id=o.id WHERE o.tenant_id=?
    AND UPPER(TRIM(COALESCE(l.item_status,''))) NOT IN ('CANCELED','CANCELLED')
    AND COALESCE(NULLIF(l.currency,''),NULLIF(o.currency,''),'USD')='USD'`,[tenant,store,numbers,tenant,store,numbers,tenant]);
  const expanded=[...new Set([...numbers,...(o[0] as Original[]).flatMap(row=>[row.orderNumber,row.customerOrderId].filter((x):x is string=>!!x))])];
  const p=await pool.query(`SELECT DISTINCT * FROM (
    SELECT id,store_id AS storeId,purchase_order_id AS purchaseOrderId,customer_order_id AS customerOrderId,sku,amount,currency,
     transaction_type AS transactionType,amount_type AS amountType,description FROM recon_transactions FORCE INDEX(recon_purchase_order_idx)
     WHERE tenant_id=? AND store_id=? AND purchase_order_id IN (?)
    UNION
    SELECT id,store_id AS storeId,purchase_order_id AS purchaseOrderId,customer_order_id AS customerOrderId,sku,amount,currency,
     transaction_type AS transactionType,amount_type AS amountType,description FROM recon_transactions FORCE INDEX(recon_customer_order_idx)
     WHERE tenant_id=? AND store_id=? AND customer_order_id IN (?)
    ) t`,[tenant,store,expanded,tenant,store,expanded]);
  originals.push(...(o[0] as Original[]).map(r=>({...r,quantity:numeric(r.quantity),revenue:numeric(r.revenue),orderedAt:r.orderedAt?new Date(r.orderedAt).toISOString():null})));
  payments.push(...(p[0] as Payment[]).map(r=>({...r,amount:Number(r.amount)})));
 }
 if(!skus.length)return buildReturnAdjustments(month,records,{originals,payments,averages:[],costs:[]});
 const [averages,costs,its]=await Promise.all([
  options.averages?Promise.resolve([options.averages]):pool.query(`SELECT UPPER(TRIM(sku)) AS sku,
   -SUM(CASE WHEN UPPER(TRIM(amount_type))='COMMISSION ON PRODUCT' THEN amount ELSE 0 END)/NULLIF(SUM(CASE WHEN UPPER(TRIM(amount_type))='PRODUCT PRICE' THEN amount ELSE 0 END),0) AS rate
   FROM recon_transactions FORCE INDEX(recon_transaction_type_idx) WHERE tenant_id=? AND store_id IN (?) AND transaction_type='Sale' AND transaction_date>=UTC_TIMESTAMP()-INTERVAL 90 DAY
    AND UPPER(TRIM(currency))='USD' AND UPPER(TRIM(sku)) IN (?)
   GROUP BY UPPER(TRIM(sku))`,[tenant,[...storeOrders.keys()],skus]),
  pool.query(`SELECT sku,purchase_cost AS purchase,freight_cost AS freight FROM (
   SELECT sku,purchase_cost,freight_cost,ROW_NUMBER() OVER(PARTITION BY sku ORDER BY updated_at DESC,period DESC) AS seq
   FROM wfs_costs WHERE tenant_id=? AND UPPER(TRIM(sku)) IN (?)) c WHERE seq=1`,[tenant,skus]),
  pool.query(`SELECT i.store_id AS storeId,UPPER(TRIM(i.sku)) AS sku,SUM(COALESCE(i.unit_transfer_charge*i.item_quantity,i.net_transfer_charge))/SUM(i.item_quantity) AS unitCost
   FROM wfs_fee_preview_items i JOIN wfs_fee_preview_options o ON o.id=i.option_id AND o.tenant_id=i.tenant_id
   WHERE i.tenant_id=? AND UPPER(TRIM(i.sku)) IN (?) AND o.preview_type='inbound' AND i.item_quantity>0
   AND COALESCE(i.currency,o.currency,'USD')='USD' AND COALESCE(i.unit_transfer_charge,i.net_transfer_charge) IS NOT NULL
   GROUP BY i.store_id,UPPER(TRIM(i.sku))`,[tenant,skus]),
 ]);
 const catalog=new Map((costs[0] as Array<{sku:string;purchase:string|null;freight:string|null}>).map(r=>[norm(r.sku),r]));
 const transfer=new Map((its[0] as Array<{storeId:string;sku:string;unitCost:string}>).map(r=>[product(r.storeId,r.sku),Number(r.unitCost)]));
 return buildReturnAdjustments(month,records,{originals,payments,averages:(averages[0] as Array<{sku:string;rate:string|null}>).filter(r=>numeric(r.rate)!=null&&Number(r.rate)>=0&&Number(r.rate)<=1).map(r=>({sku:r.sku,rate:Number(r.rate)})),
  costs:current.map(r=>{const c=catalog.get(norm(r.sku)),t=transfer.get(product(r.storeId,r.sku));return {storeId:r.storeId,sku:r.sku,unitCost:c?.purchase!=null&&c.freight!=null&&t!=null?(Number(c.purchase)+Number(c.freight))/exchangeRate+t:null};})});
}
export async function returnAdjustmentWorkbook(month:string,rows:ReturnType<typeof buildReturnAdjustments>['rows']){
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('卖家退货调整');
 const columns=[['月份','month',12],['店铺ID','storeId',20],['退货单号','returnId',24],['原订单号','orderNumber',24],['SKU','sku',28],['原销售月份','saleMonth',14],['退货时间','returnedAt',26],['退货数量','quantity',12],['商品退款 USD','refund',18],['退款来源','refundSource',24],['佣金返还 USD','commissionCredit',18],['佣金来源','commissionSource',24],['退货费用 USD','returnFees',18],['退货费用状态','feeStatus',28],['实际赔付 USD','compensation',18],['退货净扣减 USD','netDeduction',20],['不可售商品成本 USD（不重复扣）','unsellableCost',32],['待核对项目','missing',40]] as const;
 sheet.columns=columns.map(([header,key,width])=>({header,key,width}));
 for(const row of rows)sheet.addRow({...row,month,missing:row.missing.join('、')});
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:R'+Math.max(1,sheet.rowCount);
 for(const key of ['refund','commissionCredit','returnFees','compensation','netDeduction','unsellableCost'])sheet.getColumn(key).numFmt='#,##0.00';
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
