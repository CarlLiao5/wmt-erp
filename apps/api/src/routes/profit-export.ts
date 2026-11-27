import ExcelJS from 'exceljs';
import type {monthlyProfit} from './profit.js';
type ProfitData=Awaited<ReturnType<typeof monthlyProfit>>;
export async function profitWorkbook(month:string,settings:{exchangeRate:number;semDiscount:number},data:ProfitData){
 const workbook=new ExcelJS.Workbook();workbook.creator='Walmart ERP';workbook.created=new Date();
 const summary=workbook.addWorksheet('月度利润汇总');summary.columns=[{header:'项目',key:'label',width:36},{header:'金额 / 数值',key:'value',width:28}];
 const s=data.summary;
 const metrics:Array<[string,string|number|null]>=[
  ['月份',month],['金额币种','USD'],['汇率（人民币/美元）',settings.exchangeRate],['SEM减免比例',settings.semDiscount/100],
  ['订单数',s.orderCount],['订单销售额',s.revenue],['采购成本',s.purchase],['头程运费',s.freight],['尾程运费',s.lastMile],
  ['佣金',s.commission],['站内广告',s.onsite],['SEM（折后）',s.sem],['ITS转运',s.its],['卖家责任退货净扣减',s.returnDeduction],
  ['粗算毛利（已扣退货）',s.profit],['毛利率',s.revenue?s.profit/s.revenue:null],['退货前毛利（核对用）',s.profitBeforeReturns],
  ['无销量产品广告直接扣减',s.directAdvertisingDeduction],['跨月订单退货扣减',s.priorOrderReturnDeduction],['销售成本待补齐订单数',s.incomplete],
  ['退货预估记录数',data.returns.summary.estimated??0],['退货待核对记录数',data.returns.summary.incomplete??0],
 ];
 for(const [label,value]of metrics){const row=summary.addRow({label,value});row.getCell(2).numFmt=['SEM减免比例','毛利率'].includes(label)?'0.00%':typeof value==='number'?'#,##0.00':'@';}
 const products = workbook.addWorksheet('产品利润');
 const productColumns = [
  ['店铺ID', 'storeId', 20], ['SKU', 'sku', 26], ['产品中文名', 'chineseName', 36],
  ['销量', 'quantity', 12], ['销售额 USD', 'revenue', 18],
  ['采购成本', 'purchase', 16], ['头程运费', 'freight', 16], ['尾程运费', 'lastMile', 16],
  ['佣金', 'commission', 16], ['站内广告', 'onsite', 16], ['SEM（折后）', 'sem', 16],
  ['ITS转运', 'its', 16], ['卖家责任退货净扣减', 'returnDeduction', 24],
  ['粗算毛利（已扣退货）', 'profit', 24], ['毛利率', 'margin', 14], ['缺失费用', 'missing', 36],
 ] as const;
 products.columns = productColumns.map(([header, key, width]) => ({header, key, width}));
 for (const row of data.products ?? []) {
  products.addRow({
   ...row,
   ...row.fees,
   margin: row.revenue ? row.profit / row.revenue : null,
   missing: row.missing?.join('、'),
  });
 }
 for (const [, key] of productColumns) {
  products.getColumn(key).numFmt = key === 'margin' ? '0.00%'
   : key === 'quantity' ? '#,##0'
   : ['storeId', 'sku', 'chineseName', 'missing'].includes(key) ? '@' : '#,##0.00';
 }
 const orders=workbook.addWorksheet('订单利润明细');
 const columns=[['店铺ID','storeId',20],['订单号','orderNumber',26],['下单日期（Pacific）','date',24],['销售额','revenue',16],['采购成本','purchase',16],['头程运费','freight',16],['尾程运费','lastMile',16],['佣金','commission',16],['站内广告','onsite',16],['SEM（折后）','sem',16],['ITS转运','its',16],['退货扣减','returnDeduction',16],['粗算毛利（已扣退货）','profit',24],['毛利率','margin',16],['缺失成本','missing',36]] as const;
 orders.columns=columns.map(([header,key,width])=>({header,key,width}));
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
 for(const row of data.orders){const orderedAt='orderedAt' in row?row.orderedAt:null;orders.addRow({...row,date:orderedAt?formatter.format(new Date(orderedAt as string|Date)):'',margin:'revenue' in row&&row.revenue?row.profit/row.revenue:null,missing:'missing'in row?row.missing.join('、'):''});}
 for(const [,key]of columns)orders.getColumn(key).numFmt=key==='margin'?'0.00%':['storeId','orderNumber','date','missing'].includes(key)?'@':'#,##0.00';
 const returns=workbook.addWorksheet('退货扣减核对');
 const rColumns=[['退货单号','returnId',26],['原订单号','orderNumber',26],['店铺ID','storeId',20],['SKU','sku',26],['原销售月份','saleMonth',16],['退货数量','quantity',14],['商品退款','refund',16],['退款来源','refundSource',26],['佣金返还','commissionCredit',16],['佣金来源','commissionSource',26],['额外退货费用','returnFees',18],['实际赔付','compensation',16],['退货净扣减','netDeduction',18],['待核对','missing',36]] as const;
 returns.columns=rColumns.map(([header,key,width])=>({header,key,width}));
 for(const row of data.returns.rows)returns.addRow({...row,missing:row.missing.join('、')});
 for(const key of ['refund','commissionCredit','returnFees','compensation','netDeduction'])returns.getColumn(key).numFmt='#,##0.00';
 const missing=workbook.addWorksheet('SKU缺失费用');
 missing.columns=[{header:'店铺ID',key:'storeId',width:20},{header:'SKU',key:'sku',width:26},{header:'Item ID',key:'itemIds',width:26},{header:'缺失项目',key:'missing',width:36},{header:'涉及订单数',key:'orderCount',width:18},{header:'涉及销量',key:'quantity',width:16},{header:'涉及销售额 USD',key:'revenue',width:24},{header:'广告来源',key:'advertisingSource',width:18},{header:'未分摊原始广告 USD',key:'advertisingDifference',width:24},{header:'未分摊折后广告 USD',key:'advertisingNetDifference',width:24}];
 for(const row of data.missingSkus)missing.addRow({...row,missing:row.missing.join('、')});
 for(const key of ['revenue','advertisingDifference','advertisingNetDifference'])missing.getColumn(key).numFmt='#,##0.00';
 const ad=workbook.addWorksheet('广告分摊核对');ad.columns=[{header:'来源',key:'source',width:18},{header:'报表原始花费 USD',key:'reported',width:24},{header:'已计入原始花费 USD',key:'allocated',width:24},{header:'未分摊原始花费 USD',key:'unallocated',width:24},{header:'未分摊折后花费 USD',key:'netUnallocated',width:24},{header:'其中无销量直接扣减（原始）USD',key:'directDeducted',width:32}];
 for(const [source,values] of Object.entries(data.advertisingReconciliation??{}))ad.addRow({source:source==='onsite'?'站内广告':'SEM',...values});
 const notes=workbook.addWorksheet('计算说明');notes.columns=[{header:'说明',key:'text',width:120}];
 for(const text of [
 '所有费用及毛利均为 USD。销售订单与退货月份按美国太平洋时间归属。',
 '粗算毛利 = 销售额 - 采购 - 头程 - 尾程 - 佣金 - 站内广告 - 折后SEM - ITS - 当月卖家责任退货净扣减。',
 '采购/头程按数量乘成本表最新单价后除以汇率。尾程/佣金分别优先使用实际账单，再使用 SKU 手填值，最后使用全部历史 Payment 账单的 SKU 加权均值。卖家自发货不使用 WFS 尾程均价。',
 '仅Seller / Seller Keep-It的已退款退货扣减；不可售残值为0，采购等原销售成本不再次扣除。',
 '佣金返还优先实际返还，其次原订单佣金按退货数量分摊，最后SKU均值预估。实际值替代预估。',
 '月度毛利 = 订单利润明细毛利合计 - 无销量产品广告直接扣减 - 跨月订单退货扣减。跨月退货仅计入月度毛利，不伪造本月销售订单。',
 '广告分摊核对按原始花费核对总额，SEM另列减免后的未分摊额。匹配成功但无销量的广告直接扣入产品和月份毛利，不生成订单；无法匹配或关联冲突的广告列入SKU缺失费用，暂未扣入毛利。',
 '导出包含所选月份全部订单，不受页面搜索与分页限制。缺失费用未扣除，预估及缺失项请结合账单核对，税费未纳入。',
 ])notes.addRow({text});
 for(const sheet of workbook.worksheets){sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A5F'}};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};}
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
