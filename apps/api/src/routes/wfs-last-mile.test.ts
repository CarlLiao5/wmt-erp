import { expect, it } from 'vitest';
import { averageWfsLastMile } from './wfs-last-mile.js';

it('weights by shipped units and deduplicates overlapping payment pages', () => {
  const line = (po: string, tx: string, fields: Record<string, string>) => ({
    'Partner Item Id': 'abc', 'Purchase Order #': po, 'Purchase Order line #': '1',
    'Transaction Key': tx, 'Transaction Posted Timestamp': '11/01/2026', ...fields,
  });
  const charge = (po: string, amount: string) => line(po, 'fee', {'Transaction Description': 'WFS Fulfillment fee', Amount: amount});
  const purchase = (po: string, qty: string) => line(po, 'sale', {'Transaction Description': 'Purchase', 'Amount Type': 'Product Price', 'Ship Qty': qty});
  const reportData = [charge('1', '-12'), purchase('1', '3'), charge('2', '-8'), purchase('2', '1'), charge('3', '-100')];
  const page = {storeId: 'store', payload: {reportData}};
  expect(averageWfsLastMile([page, page], new Set(['ABC']), Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 2)).get('ABC')).toEqual({amount:20, units:4});
});

it('weights explicit sale commissions by matching product sales, including explicit zero rates', async () => {
  const { averagePaymentCommission } = await import('./wfs-last-mile.js');
  const row = (po: string, type: string, amount: string, transactionType = 'Sale') => ({
    'Partner Item Id': 'ABC', 'Purchase Order #': po, 'Purchase Order line #': '1',
    'Transaction Key': po + type + transactionType, 'Transaction Posted Timestamp': '11/01/2026',
    'Transaction Description': 'Purchase', 'Transaction Type': transactionType,
    'Amount Type': type, Amount: amount,
  });
  const page = {storeId: 'store', payload: {reportData: [
    row('1', 'Product Price', '100'), row('1', 'Commission on Product', '-15'),
    row('2', 'Product Price', '300'), row('2', 'Commission on Product', '0'),
    row('2', 'Commission on Product', '5', 'Refund'), row('3', 'Product Price', '1000'),
  ]}};
  expect(averagePaymentCommission([page, page], new Set(['ABC']), Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 2)).get('ABC'))
    .toEqual({commission: 15, sales: 400});
});
