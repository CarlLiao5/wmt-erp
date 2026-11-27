import { describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('@walmart-erp/db', () => ({ createDb: () => ({ pool: { query } }) }));
import { reconcileReturnPayments, summarizeReturnPayments } from './return-reconciliation.js';
const tx = (id: string, amount: number, transactionType = 'Refund', amountType = 'Product Price', description = 'Return Refund') => ({ id, amount, transactionType, amountType, description, currency: 'USD' });
describe('return payment reconciliation', () => {
  it('separates product debits, commission credits, fees and explicit reimbursements without counting sales', () => {
    const result = summarizeReturnPayments([tx('a', -100), tx('b', 15, 'Refund', 'Commission on Product'), tx('c', -5, 'Adjustment', 'Fee/Reimbursement', 'WFS Return Processing Fee'), tx('d', 100, 'Adjustment', 'Fee/Reimbursement', 'WFS Return Reimbursement'), tx('e', 100, 'Sale', 'Product Price', 'Purchase')]);
    expect(result).toMatchObject({ refundDebit: 100, commissionCredit: 15, returnFees: 5, compensation: 100, netDebit: -10, status: '已返还/抵扣', currency: 'USD' });
    expect(result.transactions).toHaveLength(4);
  });
  it('keeps missing payments pending, separates currencies, and does not call commission a compensation', () => {
    expect(summarizeReturnPayments([]).status).toBe('待核对');
    expect(summarizeReturnPayments([tx('a', -100), tx('b', 15, 'Refund', 'Commission on Product')])).toMatchObject({ status: '已扣款', compensation: 0, netDebit: 85 });
    expect(summarizeReturnPayments([tx('a', -100), { ...tx('b', 90), currency: 'CAD' }]).status).toBe('多币种待核对');
  });
});

it('matches ledger lines only in the same tenant, store, order and SKU without restricting settlement date', async () => {
  query.mockResolvedValue([[{ id: 'a', amount: '-100.00', transactionType: 'Refund', amountType: 'Product Price', description: 'Return Refund', currency: 'USD' }]]);
  const [row] = await reconcileReturnPayments('t1', [{ id: 'r', tenantId: 't1', storeId: 's1', orderId: 's1:PO-1', orderNumber: 'PO-1', sku: 'A', status: 'REFUNDED' }]);
  expect(query.mock.calls[0][1]).toEqual(['t1', 's1', 'PO-1', 'A', 't1', 's1', 'PO-1', 'A']);
  expect(query.mock.calls[0][0]).toContain('tenant_id = ? AND store_id = ?');
  expect(query.mock.calls[0][0]).toContain('UPPER(TRIM(sku))');
  expect(row.reconciliation).toMatchObject({ refundDebit: 100, status: '已扣款' });
  query.mockClear();
  await reconcileReturnPayments('t1', [{ id: 'r', storeId: 's1', orderId: '', sku: '', status: 'REFUNDED' }]);
  expect(query).not.toHaveBeenCalled();
});

it('filters WFS debit anomalies on the server before pagination, excludes sales and positive-only credits', async () => {
  const { wfsDebitExistsSql } = await import('./return-reconciliation.js');
  const sql = wfsDebitExistsSql('rr');
  expect(sql).toContain('t.tenant_id = rr.tenant_id');
  expect(sql).toContain('t.store_id = rr.store_id');
  expect(sql).toContain('t.amount < 0');
  expect(sql).toContain("'PRODUCT PRICE'");
  expect(sql).toContain("'REFUND'");
  expect(sql).toContain('recon_customer_order_idx');
  expect(sql).toContain('recon_purchase_order_idx');
});
