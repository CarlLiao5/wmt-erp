import {reconcileProfitAdvertising, type AdvertisingMissing} from './profit-advertising.js';
import { createDailyProductProfitRollup } from './product-profit-snapshot.js';
import {mysqlProductImageResolver} from './product-images.js';
import {mysqlProductChineseNameResolver} from './returns.js';
import {profitWorkbook} from './profit-export.js';
import {loadMonthlyReturnAdjustments,loadProfitReturnRecords,returnSkusForMonth,returnAdjustmentWorkbook} from './profit-returns.js';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import { createDb } from '@walmart-erp/db';
import { requestSession } from './auth.js';
import { pacificDateRangeBounds } from './commerce-source.js';
import { averagePaymentCommission, averageWfsLastMile, loadPaymentFeePages, type PaymentFeePage } from './wfs-last-mile.js';

export const PROFIT_CALCULATION_VERSION = 'normalized-payment-direct-zero-sales-v4';
export function isCurrentProfitSnapshot(result: unknown): boolean {
  try {
    const value = typeof result === 'string' ? JSON.parse(result) : result;
    return value?.calculationVersion === PROFIT_CALCULATION_VERSION;
  } catch { return false; }
}

type Settings = {exchangeRate: number; semDiscount: number};
type Inputs = Settings & {revenue:number;quantity:number;purchase:number|null;freight:number|null;lastMile:number|null;commission:number|null;onsite:number;sem:number;its:number|null};
export function calculateProfit(input: Inputs) {
  const {revenue, quantity, exchangeRate, semDiscount} = input;
  const missing = (['purchase','freight','lastMile','commission','its'] as const)
    .flatMap((key, index) => input[key] == null ? [['采购','头程','尾程','佣金','ITS'][index]!] : []);
  const purchase = (input.purchase ?? 0) * quantity / exchangeRate;
  const freight = (input.freight ?? 0) * quantity / exchangeRate;
  const lastMile = input.lastMile ?? 0;
  const commission = input.commission ?? 0;
  const onsite = input.onsite * quantity;
  const sem = input.sem * quantity * (1 - semDiscount / 100);
  const its = (input.its ?? 0) * quantity;
  return {revenue, purchase, freight, lastMile, commission, onsite, sem, its,
    profit: revenue - purchase - freight - lastMile - commission - onsite - sem - its, missing};
}

const skuKey = (sku: string) => sku.trim().toUpperCase();
const productKey = (store: string, sku: string) => JSON.stringify([store, skuKey(sku)]);
const paymentKey = (store: string, po: string, line: string, sku: string) => JSON.stringify([store, po.trim(), line.trim(), skuKey(sku)]);
const day = 86400000;
type OrderLine = {orderId:string;orderNumber:string;storeId:string;sku:string;itemId:string|null;lineNumber:string;quantity:string;revenue:string;isWfs:number|null;orderedAt:Date};
type AdRow = {storeId:string;sku:string|null;itemId:string|null;spend:string;reportDate?:string};
type ManualFees = {lastMile: string | null; commission: string | null};
type CostRow = ManualFees & {sku:string;purchase:string;freight:string|null};

export function resolveOrderFees(
  actual: {lastMile?: number; commission?: number} | undefined,
  manual: ManualFees | undefined,
  quantity: number,
  revenue: number,
  averageLastMile: number | null,
  averageCommission: number | null,
) {
  return {
    lastMile: actual?.lastMile ?? (manual?.lastMile != null ? Number(manual.lastMile) * quantity : averageLastMile),
    commission: actual?.commission ?? (manual?.commission != null ? Number(manual.commission) / 100 * revenue : averageCommission),
  };
}
type ItsRow = {storeId:string;sku:string;amount:string;units:string};

export function actualPaymentFees(pages: PaymentFeePage[]) {
  const fees = new Map<string,{lastMile?:number;commission?:number}>();
  const seen = new Set<string>();
  for (const {storeId,payload} of pages) {
    for (const row of payload.reportData ?? []) {
      const sku = row['Partner Item Id'], po = row['Purchase Order #'], line = row['Purchase Order line #'], txn = row['Transaction Key'];
      if (!sku?.trim() || !po?.trim() || !line?.trim() || !txn?.trim() || (row.Currency?.trim().toUpperCase() || 'USD') !== 'USD') continue;
      const description = row['Transaction Description']?.trim() ?? '';
      const type = row['Transaction Type']?.trim() ?? '';
      const fee = description === 'Purchase' && type === 'Sale' && row['Amount Type'] === 'Commission on Product'
        ? 'commission' : /^wfs fulfillment\s*fee$/i.test(description) && !/return|refund/i.test(type) ? 'lastMile' : null;
      const amount = Number(row.Amount);
      if (!fee || !row.Amount?.trim() || !Number.isFinite(amount) || amount > 0) continue;
      const key = paymentKey(storeId, po, line, sku);
      const identity = JSON.stringify([key, fee, txn.trim()]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const current = fees.get(key) ?? {};
      current[fee] = (current[fee] ?? 0) - amount;
      fees.set(key,current);
    }
  }
  return fees;
}

type MissingLine = {storeId:string;sku:string;itemId:string|null;orderId:string;quantity:number;revenue:number;missing:string[]};
export function summarizeMissingSkus(lines: MissingLine[]): Array<Omit<AdvertisingMissing,'advertisingSource'|'advertisingDifference'|'advertisingNetDifference'> & Partial<Pick<AdvertisingMissing,'advertisingSource'|'advertisingDifference'|'advertisingNetDifference'>>> {
  const grouped=new Map<string,{storeId:string;sku:string;itemIds:Set<string>;orderIds:Set<string>;quantity:number;revenue:number;missing:Set<string>}>();
  for(const line of lines){
    if(!line.missing.length)continue;
    const key=productKey(line.storeId,line.sku);
    const row=grouped.get(key)??{storeId:line.storeId,sku:skuKey(line.sku),itemIds:new Set<string>(),orderIds:new Set<string>(),quantity:0,revenue:0,missing:new Set<string>()};
    if(line.itemId)row.itemIds.add(line.itemId);
    row.orderIds.add(line.orderId);row.quantity+=line.quantity;row.revenue+=line.revenue;
    for(const field of line.missing)row.missing.add(field);
    grouped.set(key,row);
  }
  return [...grouped.values()].map(({itemIds,orderIds,missing,...row})=>({...row,itemIds:[...itemIds].join('、'),orderCount:orderIds.size,missing:[...missing]}));
}
export async function missingCostsWorkbook(month:string,rows:ReturnType<typeof summarizeMissingSkus>){
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('SKU缺失费用');
  sheet.columns=[
    {header:'月份',key:'month',width:12},{header:'店铺ID',key:'storeId',width:22},
    {header:'SKU',key:'sku',width:28},{header:'Item ID',key:'itemIds',width:26},
    {header:'缺失项目',key:'missing',width:32},{header:'涉及订单数',key:'orderCount',width:16},
    {header:'涉及销量',key:'quantity',width:16},{header:'涉及销售额（USD）',key:'revenue',width:24},
    {header:'广告来源',key:'advertisingSource',width:18},{header:'未分摊原始广告 USD',key:'advertisingDifference',width:24},{header:'未分摊折后广告 USD',key:'advertisingNetDifference',width:24},
  ];
  for(const row of rows)sheet.addRow({...row,month,missing:row.missing.join('、')});
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A5F'}};
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:K'+Math.max(1,sheet.rowCount);
  for(const field of ['revenue','advertisingDifference','advertisingNetDifference'])sheet.getColumn(field).numFmt='#,##0.00';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function settings(tenant: string): Promise<Settings | null> {
  const [rows] = await createDb().pool.query('SELECT exchange_rate, sem_discount FROM profit_settings WHERE tenant_id=?',[tenant]);
  const [row] = rows as Array<{exchange_rate:string;sem_discount:string}>;
  return row ? {exchangeRate:Number(row.exchange_rate),semDiscount:Number(row.sem_discount)} : null;
}

const productFeeFields = ['purchase','freight','lastMile','commission','onsite','sem','its'] as const;
type ProductFees = Pick<ReturnType<typeof calculateProfit>, typeof productFeeFields[number]>;

export function createProductProfitRollup() {
  const products = new Map<string, {storeId:string; sku:string; quantity:number; revenue:number; profit:number; returnDeduction:number; fees:ProductFees; missing:string[]}>();
  function product(storeId:string, sku:string) {
    const key = productKey(storeId, sku);
    const row = products.get(key) ?? {storeId, sku:skuKey(sku), quantity:0, revenue:0, profit:0, returnDeduction:0, fees:{purchase:0,freight:0,lastMile:0,commission:0,onsite:0,sem:0,its:0}, missing:[]};
    products.set(key, row);
    return row;
  }
  return {
    addSale(storeId:string, sku:string, quantity:number, revenue:number, profit:number, calculation?:ProductFees & {missing:string[]}) {
      const row = product(storeId, sku);
      row.quantity += quantity;
      row.revenue += revenue;
      row.profit += profit;
      if (calculation) {
        for (const field of productFeeFields) row.fees[field] += calculation[field];
        row.missing = [...new Set([...row.missing, ...calculation.missing])];
      }
    },
    addReturn(storeId:string, sku:string, deduction:number) {
      const row = product(storeId, sku);
      row.returnDeduction += deduction;
      row.profit -= deduction;
    },
    rows: () => [...products.values()],
  };
}

async function productProfitRows(tenant:string, rollup:ReturnType<typeof createProductProfitRollup>,
  returns:Array<{storeId:string;sku:string;netDeduction:number}>) {
  for (const row of returns) rollup.addReturn(row.storeId, row.sku, row.netDeduction);
  const rows = rollup.rows();
  if (!rows.length) return [];
  const [images, names] = await Promise.all([
    mysqlProductImageResolver()(tenant, rows),
    mysqlProductChineseNameResolver()(tenant, rows),
  ]);
  return rows.map(row => {
    const key = row.storeId + ':' + row.sku;
    return {...row, imageUrl:images.get(key), chineseName:names.get(key)};
  }).sort((a,b) => b.profit-a.profit);
}

export async function monthlyProfit(tenant: string, month: string, parameters: Settings) {
  const end = new Date(month + '-01T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  const next = end.toISOString().slice(0,10);
  const [fromUtc,toUtc] = pacificDateRangeBounds(month+'-01',new Date(end.getTime()-day).toISOString().slice(0,10));
  const { pool } = createDb();
  const [returnRecords, orderResult] = await Promise.all([loadProfitReturnRecords(tenant), pool.query(
    `SELECT o.id AS orderId,o.external_id AS orderNumber,o.store_id AS storeId,s.external_id AS sku,s.item_id AS itemId,
       l.line_number AS lineNumber,l.quantity,l.line_amount AS revenue,o.is_wfs AS isWfs,o.ordered_at AS orderedAt
     FROM orders o JOIN order_lines l ON l.order_id=o.id AND l.tenant_id=o.tenant_id AND l.store_id=o.store_id
     JOIN skus s ON s.id=l.sku_id AND s.tenant_id=o.tenant_id AND s.store_id=o.store_id
     WHERE o.tenant_id=? AND o.ordered_at>=? AND o.ordered_at<?
       AND UPPER(TRIM(o.status)) NOT IN ('CANCELED','CANCELLED')
       AND UPPER(TRIM(COALESCE(l.item_status,''))) NOT IN ('CANCELED','CANCELLED')
       AND COALESCE(NULLIF(l.currency,''),NULLIF(o.currency,''),'USD')='USD'
     ORDER BY o.ordered_at DESC,o.id,l.line_number`, [tenant,fromUtc,toUtc])]);
  const orders = orderResult[0] as OrderLine[];
  const skus = [...new Set([...orders.map((row)=>skuKey(row.sku)),...returnSkusForMonth(month,returnRecords)])];
  const productProfits = createProductProfitRollup();
  const dailyProductProfits = createDailyProductProfitRollup();

  const today = Math.floor(Date.now()/day)*day+day;
  const [costResult, onsiteResult, semResult, itsResult, payment,catalogResult] = await Promise.all([
    pool.query(`SELECT c.sku,c.purchase_cost AS purchase,c.freight_cost AS freight,
      f.last_mile AS lastMile,f.commission_percent AS commission FROM (
      SELECT sku,purchase_cost,freight_cost,ROW_NUMBER() OVER(PARTITION BY sku ORDER BY updated_at DESC,period DESC) AS seq
      FROM wfs_costs WHERE tenant_id=? AND sku IN (?)
    ) c LEFT JOIN wfs_cost_fee_overrides f ON f.tenant_id=? AND f.sku=c.sku
      WHERE c.seq=1`,[tenant,skus.length?skus:[''],tenant]),
    pool.query(`SELECT s.id AS storeId,a.msku AS sku,a.item_id AS itemId,DATE_FORMAT(a.report_date,'%Y-%m-%d') AS reportDate,SUM(a.spend) AS spend
      FROM ad_item_report a JOIN stores s ON s.tenant_id=? AND
      (CASE a.store_name COLLATE utf8mb4_unicode_ci WHEN '鑫起典沃尔玛' THEN '鑫启典沃尔玛' ELSE a.store_name END) COLLATE utf8mb4_unicode_ci=s.name COLLATE utf8mb4_unicode_ci
      WHERE a.report_date>=? AND a.report_date<? GROUP BY s.id,a.msku,a.item_id,a.report_date`,[tenant,month+'-01',next]),
    pool.query(`SELECT storeId,sku,itemId,DATE_FORMAT(report_date,'%Y-%m-%d') AS reportDate,SUM(ad_spend) AS spend FROM (
      SELECT store_id AS storeId,sku,item_id AS itemId,report_date,ad_spend,
        ROW_NUMBER() OVER(PARTITION BY store_id,report_date,campaign_id,sku ORDER BY received_at DESC,id DESC) AS seq
      FROM sem_performance_daily WHERE tenant_id=? AND report_date>=? AND report_date<? AND COALESCE(currency,'USD')='USD'
    ) p WHERE seq=1 GROUP BY storeId,sku,itemId,report_date`,[tenant,month+'-01',next]),
    pool.query(`SELECT i.store_id AS storeId,i.sku,
      SUM(COALESCE(i.unit_transfer_charge*i.item_quantity,i.net_transfer_charge)) AS amount,SUM(i.item_quantity) AS units
      FROM wfs_fee_preview_items i JOIN wfs_fee_preview_options o ON o.id=i.option_id AND o.tenant_id=i.tenant_id
      WHERE i.tenant_id=? AND i.sku IN (?) AND o.preview_type='inbound' AND i.item_quantity>0
        AND COALESCE(i.currency,o.currency,'USD')='USD' AND COALESCE(i.unit_transfer_charge,i.net_transfer_charge) IS NOT NULL
      GROUP BY i.store_id,i.sku`,[tenant,skus.length?skus:['']]),
    loadPaymentFeePages(tenant,skus),
    pool.query('SELECT store_id AS storeId,external_id AS sku,item_id AS itemId,0 AS quantity FROM skus WHERE tenant_id=?',[tenant]),
  ]);
  const skuSet = new Set(skus);
  const actual = actualPaymentFees(payment);
  const tail = averageWfsLastMile(payment,skuSet,Number.NEGATIVE_INFINITY,today);
  const commissions = averagePaymentCommission(payment,skuSet,Number.NEGATIVE_INFINITY,today);
  const returnAdjustments=await loadMonthlyReturnAdjustments(tenant,month,parameters.exchangeRate,{records:returnRecords,averages:[...commissions].map(([sku,value])=>({sku,rate:value.commission/value.sales}))});
  const costs = new Map((costResult[0] as CostRow[]).map(row=>[skuKey(row.sku),row]));
  const its = new Map((itsResult[0] as ItsRow[]).map(row=>[productKey(row.storeId,row.sku),Number(row.amount)/Number(row.units)]));
  const units = new Map<string,number>();
  for (const row of orders) {
    const key = productKey(row.storeId,row.sku);
    units.set(key,(units.get(key) ?? 0)+Math.max(0,Number(row.quantity)));
  }
  const saleProducts=orders.map(row=>({...row,quantity:Number(row.quantity)}));
  const catalog=catalogResult[0] as Array<{storeId:string;sku:string;itemId:string|null;quantity:number}>;
  const onsiteMatch=reconcileProfitAdvertising(saleProducts,onsiteResult[0] as AdRow[],'站内广告',0,catalog);
  const semMatch=reconcileProfitAdvertising(saleProducts,semResult[0] as AdRow[],'SEM',parameters.semDiscount,catalog);
  const onsite=onsiteMatch.allocated,sem=semMatch.allocated;
  const advertisingMissing=[...onsiteMatch.missing,...semMatch.missing];
  const advertisingWarnings=new Map<string,string[]>();
  for(const row of advertisingMissing)if(row.sku){const key=productKey(row.storeId,row.sku);advertisingWarnings.set(key,[...new Set([...(advertisingWarnings.get(key)??[]),...row.missing])]);}
  const grouped = new Map<string,ReturnType<typeof summarize> & {orderNumber:string;storeId:string;orderId:string;orderedAt:Date;missing:string[]}>();
  const missingLines:MissingLine[]=[];
  for (const row of orders) {
    const sku = skuKey(row.sku);
    const key = productKey(row.storeId,sku);
    const quantity = Math.max(0,Number(row.quantity));
    const revenue = Number(row.revenue);
    const paymentFee = actual.get(paymentKey(row.storeId,row.orderNumber,row.lineNumber ?? '',sku));
    const avgTail = tail.get(sku);
    const avgCommission = commissions.get(sku);
    const cost = costs.get(sku);
    const denominator = units.get(key) || 1;
    const calculation = calculateProfit({
      ...parameters,revenue,quantity,purchase:cost ? Number(cost.purchase) : null,freight:cost?.freight != null ? Number(cost.freight) : null,
      ...resolveOrderFees(paymentFee, cost, quantity, revenue,
        row.isWfs === 0 || !avgTail ? null : avgTail.amount / avgTail.units * quantity,
        avgCommission ? avgCommission.commission / avgCommission.sales * revenue : null,
      ),
      onsite:(onsite.get(key) ?? 0)/denominator,sem:(sem.get(key) ?? 0)/denominator,
      its:row.isWfs === 0 ? 0 : its.get(key) ?? null,
    });
    calculation.missing.push(...(advertisingWarnings.get(key)??[]));
    if (row.quantity == null || quantity <= 0) calculation.missing.push('销量');
    if (row.revenue == null) calculation.missing.push('订单金额');
    dailyProductProfits.add(row.orderedAt, row.storeId, sku, calculation.profit);
    productProfits.addSale(row.storeId, sku, quantity, calculation.revenue, calculation.profit, calculation);
    if(calculation.missing.length)missingLines.push({storeId:row.storeId,sku:row.sku,itemId:row.itemId,orderId:row.orderId,quantity,revenue,missing:calculation.missing});
    const order = grouped.get(row.orderId) ?? {
      ...summarize([]),orderNumber:row.orderNumber,storeId:row.storeId,orderId:row.orderId,orderedAt:row.orderedAt,missing:[],
    };
    for (const field of moneyFields) order[field] += calculation[field];
    order.missing = [...new Set([...order.missing,...calculation.missing])];
    grouped.set(row.orderId,order);
  }
  for (const row of returnAdjustments.rows) {
    if (row.returnedAt) dailyProductProfits.add(row.returnedAt, row.storeId, skuKey(row.sku), -row.netDeduction);
  }
  const result = [...grouped.values()];
  const summary={...summarize(result),directAdvertisingDeduction:0};
  for(const charge of [...onsiteMatch.directCharges,...semMatch.directCharges]){
    const field=charge.source==='SEM'?'sem':'onsite';
    summary[field]+=charge.netAmount;summary.profit-=charge.netAmount;summary.directAdvertisingDeduction+=charge.netAmount;
    const fees={purchase:0,freight:0,lastMile:0,commission:0,onsite:0,sem:0,its:0,missing:[] as string[]};fees[field]=charge.netAmount;
    productProfits.addSale(charge.storeId,charge.sku,0,0,-charge.netAmount,fees);
    dailyProductProfits.add(charge.reportDate??month+'-01',charge.storeId,charge.sku,-charge.netAmount);
  }
  return {calculationVersion:PROFIT_CALCULATION_VERSION,...applyMonthlyReturns(result,summary,returnAdjustments.rows),advertisingReconciliation:{onsite:onsiteMatch.summary,sem:semMatch.summary},missingSkus:[...summarizeMissingSkus(missingLines),...advertisingMissing],dailyProductProfits:dailyProductProfits.rows(),products:await productProfitRows(tenant,productProfits,returnAdjustments.rows),returns:returnAdjustments};
}
const moneyFields = ['revenue','purchase','freight','lastMile','commission','onsite','sem','its','profit'] as const;
function summarize(rows: Array<Pick<ReturnType<typeof calculateProfit>,typeof moneyFields[number]> & {missing:string[]}>) {
  const total = {revenue:0,purchase:0,freight:0,lastMile:0,commission:0,onsite:0,sem:0,its:0,profit:0,orderCount:rows.length,incomplete:0};
  for (const row of rows) {
    for (const key of moneyFields) total[key] += row[key];
    if (row.missing.length) total.incomplete++;
  }
  return total;
}

export function applyMonthlyReturns<T extends {storeId:string;orderNumber:string;profit:number},S extends {profit:number}>(orders:T[],summary:S,returns:Array<{storeId:string;orderNumber:string;canonicalOrderNumber?:string;netDeduction:number}>){
 const key=(store:string,order:string)=>JSON.stringify([store,order]);
 const deductions=new Map<string,number>();
 for(const row of returns){const id=key(row.storeId,row.canonicalOrderNumber??row.orderNumber);deductions.set(id,(deductions.get(id)??0)+row.netDeduction);}
 let matched=0;
 const adjustedOrders=orders.map(row=>{const returnDeduction=deductions.get(key(row.storeId,row.orderNumber))??0;matched+=returnDeduction;return {...row,profitBeforeReturns:row.profit,returnDeduction,profit:row.profit-returnDeduction};});
 const returnDeduction=returns.reduce((sum,row)=>sum+row.netDeduction,0),profit=summary.profit-returnDeduction;
 return {orders:adjustedOrders,summary:{...summary,profitBeforeReturns:summary.profit,returnDeduction,priorOrderReturnDeduction:returnDeduction-matched,profit,adjustedProfit:profit}};
}

type ProfitSnapshot = {
  exchangeRate: string;
  semDiscount: string;
  calculatedAt: string;
  result: Awaited<ReturnType<typeof monthlyProfit>> | string;
};

export async function invalidateMonthlyProfit(tenant: string) {
  await createDb().pool.query(
    'UPDATE monthly_profit_snapshots SET next_run_at=UTC_TIMESTAMP(3), revision=revision+1 WHERE tenant_id=?',
    [tenant],
  );
}

async function readMonthlyProfit(tenant: string, month: string) {
  const {pool} = createDb();
  const [rows] = await pool.query(
    `SELECT exchange_rate AS exchangeRate, sem_discount AS semDiscount,
       CONCAT(LEFT(DATE_FORMAT(calculated_at, '%Y-%m-%dT%H:%i:%s.%f'),23),'Z') AS calculatedAt, result
     FROM monthly_profit_snapshots WHERE tenant_id=? AND profit_month=? AND calculated_at IS NOT NULL`,
    [tenant, month],
  );
  const [snapshot] = rows as ProfitSnapshot[];
  if (snapshot && isCurrentProfitSnapshot(snapshot.result)) return snapshot;
  await pool.query(
    `INSERT INTO monthly_profit_snapshots (tenant_id, profit_month, next_run_at) VALUES (?,?,UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE next_run_at=LEAST(next_run_at,UTC_TIMESTAMP(3))`,
    [tenant, month],
  );
  return null;
}

const validProfitMonth = (month: unknown): month is string =>
  typeof month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month);

async function monthlyProfitStatus(tenant: string, month: string) {
  const [rows] = await createDb().pool.query(
    `SELECT CONCAT(LEFT(DATE_FORMAT(calculated_at, '%Y-%m-%dT%H:%i:%s.%f'),23),'Z') AS calculatedAt,
       CONCAT(LEFT(DATE_FORMAT(next_run_at, '%Y-%m-%dT%H:%i:%s.%f'),23),'Z') AS nextRunAt,
       CASE WHEN run_connection_id=IS_USED_LOCK('wmterp-monthly-profit') THEN 'running'
            WHEN failed_at IS NOT NULL THEN 'failed'
            WHEN next_run_at<=UTC_TIMESTAMP(3) OR calculated_at IS NULL THEN 'queued'
            ELSE 'ready' END AS state
     FROM monthly_profit_snapshots WHERE tenant_id=? AND profit_month=?`,
    [tenant, month],
  );
  const [status] = rows as Array<{calculatedAt:string|null;nextRunAt:string;state:string}>;
  return status ?? {calculatedAt:null,nextRunAt:null,state:'idle'};
}

export function profitRouter(): Router {
  const router = Router();
  router.use('/profit',async(req,res,next)=>{
    try {
      const session = await requestSession(req,false);
      if (session?.role !== 'admin') return res.status(session ? 403 : 401).json({error:{message:'仅管理员可访问利润粗算'}});
      res.locals.profitTenant = session.tenantId;
      res.set('Cache-Control','no-store');
      return next();
    } catch (error) { return next(error); }
  });
  router.get('/profit/settings',async(_req,res,next)=>{
    try {return res.json({data:await settings(res.locals.profitTenant)});} catch(error){return next(error);}
  });
  router.post('/profit/settings',async(req,res,next)=>{
    try {
      if (!req.is('application/json')) return res.sendStatus(415);
      const {exchangeRate,semDiscount} = req.body ?? {};
      if (typeof exchangeRate !== 'number' || !Number.isFinite(exchangeRate) || exchangeRate < 0.000001 || exchangeRate > 100000
        || typeof semDiscount !== 'number' || !Number.isFinite(semDiscount) || semDiscount < 0 || semDiscount > 100) {
        return res.status(400).json({error:{message:'汇率必须大于 0，SEM 折扣须在 0% 至 100% 之间'}});
      }
      await createDb().pool.query(`INSERT INTO profit_settings (tenant_id,exchange_rate,sem_discount) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE exchange_rate=VALUES(exchange_rate),sem_discount=VALUES(sem_discount)`,[res.locals.profitTenant,exchangeRate,semDiscount]);
      await invalidateMonthlyProfit(res.locals.profitTenant);
      return res.json({data:await settings(res.locals.profitTenant)});
    } catch(error){return next(error);}
  });
  router.get('/profit/status', async (req,res,next) => {
    try {
      const month = req.query.month;
      if (!validProfitMonth(month)) return res.status(400).json({error:{message:'请选择有效月份'}});
      return res.json({data:await monthlyProfitStatus(res.locals.profitTenant, month)});
    } catch (error) { return next(error); }
  });
  router.post('/profit/calculate', async (req,res,next) => {
    try {
      if (!req.is('application/json')) return res.sendStatus(415);
      const month = req.body?.month;
      if (!validProfitMonth(month)) return res.status(400).json({error:{message:'请选择有效月份'}});
      const tenant = res.locals.profitTenant;
      if (!await settings(tenant)) return res.status(409).json({error:{message:'请先保存汇率和 SEM 折扣'}});
      await createDb().pool.query(
        `INSERT INTO monthly_profit_snapshots (tenant_id, profit_month, next_run_at)
         VALUES (?,?,UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           failed_at=IF(COALESCE(run_connection_id=IS_USED_LOCK('wmterp-monthly-profit'),0),failed_at,NULL),
           next_run_at=LEAST(next_run_at,UTC_TIMESTAMP(3))`,
        [tenant, month],
      );
      return res.status(202).json({data:await monthlyProfitStatus(tenant, month)});
    } catch (error) { return next(error); }
  });
  router.get(['/profit','/profit/export','/profit/missing-costs/export','/profit/returns/export'],async(req,res,next)=>{
    try {
      const month = req.query.month;
      if (!validProfitMonth(month)) return res.status(400).json({error:{message:'请选择有效月份'}});
      const parameters = await settings(res.locals.profitTenant);
      if (!parameters) return res.status(409).json({error:{message:'请先保存汇率和 SEM 折扣'}});
      const snapshot = await readMonthlyProfit(res.locals.profitTenant, month);
      if (!snapshot) {
        if (req.path.endsWith('/export')) return res.status(409).json({error:{message:'该月份正在排队核算，结果生成后可下载'}});
        return res.status(202).json({data:{pending:true}});
      }
      const data = typeof snapshot.result === 'string' ? JSON.parse(snapshot.result) as Awaited<ReturnType<typeof monthlyProfit>> : snapshot.result;
      const snapshotSettings = {exchangeRate:Number(snapshot.exchangeRate),semDiscount:Number(snapshot.semDiscount)};
      if(req.path.endsWith('/export')){
        res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.set('Content-Disposition','attachment; filename="profit-missing-costs-'+month+'.xlsx"');
        if(req.path==='/profit/export'){
          res.set('Content-Disposition','attachment; filename="profit-'+month+'.xlsx"');
          return res.send(await profitWorkbook(month,snapshotSettings,data));
        }
        if(req.path==='/profit/returns/export'){
          res.set('Content-Disposition','attachment; filename="profit-returns-'+month+'.xlsx"');
          return res.send(await returnAdjustmentWorkbook(month,data.returns.rows));
        }
        return res.send(await missingCostsWorkbook(month,data.missingSkus));
      }
      return res.json({data:{...data,dailyProductProfits:undefined,calculatedAt:snapshot.calculatedAt,pending:parameters.exchangeRate!==snapshotSettings.exchangeRate || parameters.semDiscount!==snapshotSettings.semDiscount}});
    } catch(error){return next(error);}
  });
  return router;
}
