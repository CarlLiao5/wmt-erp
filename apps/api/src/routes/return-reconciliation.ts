import { createDb } from '@walmart-erp/db';
import type { ReturnRecord } from './returns.js';
export interface PaymentLine { id: string; amount: number; transactionType: string | null; amountType: string | null; description: string; currency: string; sourceId?: string; transactionDate?: string; customerOrderId?: string; purchaseOrderId?: string; sku?: string; }
const key = (value: unknown) => String(value ?? '').trim().toUpperCase();
export function summarizeReturnPayments(lines: PaymentLine[]) {
  const transactions = lines.filter(x => key(x.transactionType) === 'REFUND' || /RETURN|REIMBURSEMENT|COMPENSATION/i.test(x.description));
  const currencies = new Set(transactions.map(x => x.currency));
  const sum = (predicate: (x: PaymentLine) => boolean) => Math.round(transactions.filter(predicate).reduce((n,x) => n + x.amount,0)*10000)/10000;
  const refundDebit = -sum(x => key(x.transactionType) === 'REFUND' && key(x.amountType) === 'PRODUCT PRICE' && x.amount < 0);
  const commissionCredit = sum(x => key(x.transactionType) === 'REFUND' && /COMMISSION/i.test(x.amountType ?? '') && x.amount > 0);
  const returnFees = -sum(x => key(x.transactionType) !== 'REFUND' && /RETURN.*(?:FEE|CHARGE)/i.test(x.description) && x.amount < 0);
  const compensation = sum(x => /REIMBURSEMENT|COMPENSATION/i.test(x.description) && x.amount > 0);
  const netDebit = -sum(() => true);
  return { refundDebit, commissionCredit, returnFees, compensation, netDebit, currency: currencies.size === 1 ? [...currencies][0] : null, status: currencies.size > 1 ? '多币种待核对' : !transactions.length ? '待核对' : netDebit > 0 ? '已扣款' : refundDebit > 0 || compensation > 0 || netDebit < 0 ? '已返还/抵扣' : '未见净扣款', transactions };
}
export async function reconcileReturnPayments(tenantId: string, rows: ReturnRecord[]) {
  if (!rows.length) return [];
  const { pool } = createDb();
  return Promise.all(rows.map(async row => {
    const order = row.orderNumber || row.orderId.replace(`${row.storeId}:`, '');
    if (!order || !row.sku) return { ...row, reconciliation: summarizeReturnPayments([]) };
    const columns = 'id, amount, transaction_type AS transactionType, amount_type AS amountType, description, currency, source_id AS sourceId, transaction_date AS transactionDate, customer_order_id AS customerOrderId, purchase_order_id AS purchaseOrderId, sku';
    const [result] = await pool.query(`SELECT * FROM (
      SELECT ${columns} FROM recon_transactions FORCE INDEX (recon_customer_order_idx) WHERE tenant_id = ? AND store_id = ? AND customer_order_id = ? AND UPPER(TRIM(sku)) = UPPER(TRIM(?))
      UNION
      SELECT ${columns} FROM recon_transactions FORCE INDEX (recon_purchase_order_idx) WHERE tenant_id = ? AND store_id = ? AND purchase_order_id = ? AND UPPER(TRIM(sku)) = UPPER(TRIM(?))
    ) matched ORDER BY transactionDate, id`, [tenantId, row.storeId, order, row.sku, tenantId, row.storeId, order, row.sku]);
    const lines = (result as PaymentLine[]).map(x => ({ ...x, amount: Number(x.amount) }));
    return { ...row, reconciliation: summarizeReturnPayments(lines) };
  }));
}

// Correlated index lookups keep the anomaly filter ahead of pagination.
export function wfsDebitExistsSql(alias = 'rr') {
  const eligible = `t.amount < 0 AND ((UPPER(TRIM(t.transaction_type)) = 'REFUND' AND UPPER(TRIM(t.amount_type)) = 'PRODUCT PRICE') OR (COALESCE(UPPER(TRIM(t.transaction_type)), '') <> 'REFUND' AND UPPER(t.description) REGEXP 'RETURN.*(FEE|CHARGE)'))`;
  const scope = `t.tenant_id = ${alias}.tenant_id COLLATE utf8mb4_unicode_ci AND t.store_id = ${alias}.store_id COLLATE utf8mb4_unicode_ci AND UPPER(TRIM(t.sku)) = UPPER(TRIM(${alias}.sku)) COLLATE utf8mb4_unicode_ci`;
  return `(${['customer','purchase'].map(kind => `EXISTS (SELECT 1 FROM recon_transactions t FORCE INDEX (recon_${kind}_order_idx) WHERE ${scope} AND t.${kind}_order_id = ${alias}.order_number COLLATE utf8mb4_unicode_ci AND ${eligible})`).join(' OR ')})`;
}
