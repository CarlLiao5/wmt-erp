import ExcelJS from 'exceljs';
import type { ReturnPageQuery, ReturnPageResult } from './commerce-source.js';
import { reconcileReturnPayments } from './return-reconciliation.js';
export async function returnReconciliationWorkbook(tenantId: string, query: ReturnPageQuery,
 listPage: (tenantId: string, query: ReturnPageQuery) => Promise<ReturnPageResult>,
 reconcile: typeof reconcileReturnPayments = reconcileReturnPayments) {
 const workbook = new ExcelJS.Workbook();
 const summary = workbook.addWorksheet('WFS扣款异常', { views: [{ state: 'frozen', ySplit: 1 }] });
 const details = workbook.addWorksheet('账单明细', { views: [{ state: 'frozen', ySplit: 1 }] });
 summary.addRow(['店铺','退货号','订单号','SKU','责任归属','币种','退款扣款','佣金返还','退货费用','明确补偿','净扣款','核对状态']);
 details.addRow(['店铺','订单号','SKU','账单来源','交易日期','交易类型','金额类型','交易描述','币种','金额','交易记录ID']);
 for (let page = 1; ; page++) {
   const result = await listPage(tenantId, { ...query, page, pageSize: 100, reconciliation: true, responsibility: 'wfs' });
   const rows = await reconcile(tenantId, result.rows);
   for (const row of rows) {
     const a = row.reconciliation; const order = row.orderNumber || row.orderId.replace(`${row.storeId}:`, '');
     summary.addRow([row.storeId,row.returnId ?? row.id,order,row.sku,row.refundCoveredBy ?? '',a.currency ?? '多币种',...[a.refundDebit,a.commissionCredit,a.returnFees,a.compensation,a.netDebit].map(v=>a.currency ? v : null),a.status]);
     for (const t of a.transactions) details.addRow([row.storeId,order,row.sku,t.sourceId ?? '',String(t.transactionDate ?? '').slice(0,10),t.transactionType,t.amountType,t.description,t.currency,t.amount,t.id]);
   }
   if (!result.rows.length || page * 100 >= result.total) break;
 }
 for (const sheet of [summary,details]) {
   sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
   sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B61' } };
   sheet.getRow(1).height = 25;
   sheet.columns.forEach((column,i)=>{ column.width = i === 0 ? 22 : 24; });
   sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1,sheet.rowCount), column: sheet.columnCount } };
 }
 for (const column of [7,8,9,10,11]) summary.getColumn(column).numFmt = '#,##0.00;[Red]-#,##0.00';
 details.getColumn(10).numFmt = '#,##0.00;[Red]-#,##0.00';
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
