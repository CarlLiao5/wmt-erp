import {returnAdjustmentWorkbook} from '../apps/api/src/routes/profit-returns.js';
import {createDb} from '../packages/db/index.js';
import {readFile} from 'node:fs/promises';
import {monthlyProfit,missingCostsWorkbook} from '../apps/api/src/routes/profit.js';
const {pool}=createDb();
try {
 const url=new URL(process.env.MYSQL_URL!);
 if(!/doke/i.test(url.hostname+url.pathname)) throw Error('Expected Doke database');
 await pool.query(await readFile('packages/db/migrations/0060_profit_settings.sql','utf8'));
 const start=performance.now();
 const data=await monthlyProfit('default','2026-11',{exchangeRate:7,semDiscount:20});
 if(Math.abs(data.summary.adjustedProfit-(data.summary.profitBeforeReturns-data.returns.summary.netDeduction))>1e-6)throw Error('Return adjustment reconciliation failed');
 if(Math.abs(data.summary.profit-data.summary.adjustedProfit)>1e-6)throw Error('Canonical profit not adjusted');
 if(data.orders.some(row=>Math.abs(row.profit-(row.profitBeforeReturns-row.returnDeduction))>1e-6))throw Error('Order profit not adjusted');
 if(Math.abs(data.orders.reduce((sum,row)=>sum+row.profit,0)-data.summary.priorOrderReturnDeduction-data.summary.profit)>1e-6)throw Error('Month/order return reconciliation failed');
 const returned=await returnAdjustmentWorkbook('2026-11',data.returns.rows);
 const workbook=await missingCostsWorkbook('2026-11',data.missingSkus);
 const {default:ExcelJS}=await import('../apps/api/node_modules/exceljs/excel.js');
 const parsed=new ExcelJS.Workbook();await parsed.xlsx.load(workbook as any);
 if(parsed.worksheets[0].rowCount!==data.missingSkus.length+1)throw Error('Export row mismatch');
 if(new Set(data.missingSkus.map(row=>JSON.stringify([row.storeId,row.sku]))).size!==data.missingSkus.length)throw Error('Duplicate SKU');
 console.log(JSON.stringify({exportRows:data.missingSkus.length,xlsxBytes:workbook.length,returnExportBytes:returned.length,returnSummary:data.returns.summary,verifiedXlsx:true}));
 console.log(JSON.stringify({transientTestParameters:true,orders:data.orders.length,summary:data.summary,ms:Math.round(performance.now()-start)}));
 if(!data.orders.length||!Number.isFinite(data.summary.profit))throw Error('Invalid calculation');
} catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}finally{await pool.end();}
process.exit(process.exitCode??0);
