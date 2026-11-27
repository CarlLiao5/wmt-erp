import assert from 'node:assert/strict';
import {loadMonthlyReturnAdjustments,returnAdjustmentWorkbook} from '../apps/api/src/routes/profit-returns.js';
import ExcelJS from '../apps/api/node_modules/exceljs/excel.js';
try{
 const url=new URL(process.env.MYSQL_URL!);assert(/doke/i.test(url.host+url.pathname),'Doke only');
 const start=performance.now();const data=await loadMonthlyReturnAdjustments('default','2026-11',7);
 assert(data.rows.length>0);
 assert(data.rows.every(r=>['Seller','Seller Keep-It'].includes(r.responsibility??'')));
 assert(Math.abs(data.rows.reduce((n,r)=>n+r.netDeduction,0)-data.summary.netDeduction)<1e-6);
 assert(data.rows.every(r=>Math.abs(r.netDeduction-(r.refund+r.returnFees-r.commissionCredit-r.compensation))<1e-6));
 const buffer=await returnAdjustmentWorkbook('2026-11',data.rows);const w=new ExcelJS.Workbook();await w.xlsx.load(buffer as any);
 assert.equal(w.worksheets[0].rowCount,data.rows.length+1);
 const sources=Object.fromEntries([...new Set(data.rows.map(r=>r.commissionSource))].map(source=>[source,data.rows.filter(r=>r.commissionSource===source).length]));
 console.log(JSON.stringify({summary:data.summary,commissionSources:sources,crossMonth:data.rows.filter(r=>r.saleMonth&&r.saleMonth!=='2026-11').length,missing:data.rows.filter(r=>r.missing.length).reduce((r,row)=>{for(const key of row.missing)r[key]=(r[key]??0)+1;return r;},{} as Record<string,number>),exportRows:w.worksheets[0].rowCount-1,ms:Math.round(performance.now()-start)}));
}catch(error){console.error(error);process.exitCode=1;}
process.exit(process.exitCode??0);
