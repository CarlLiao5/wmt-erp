import { describe, expect, it } from 'vitest';
import { parseMonthlyTargetWorkbook, parseTargetWorkbook, targetMonthlyWorkbook, targetWorkbook } from './xlsx.js';

describe('target xlsx helpers', () => {
  it('round trips month and target rows through asynchronous workbook IO', async () => {
    const workbook = targetWorkbook([{ month: '2026-12', target: 345.5 }]);
    expect(workbook).toBeInstanceOf(Promise);
    const rows = await parseTargetWorkbook(await workbook);
    expect(rows[0]).toMatchObject({ month: '2026-12', target: 345.5, amountTarget: 345.5 });
  });

  it('exports monthly target formulas and parses editable inputs separately', async () => {
    const workbook = await targetMonthlyWorkbook([{
      month: '2026-11', storeId: 'store-1', sku: 'SKU-1', itemId: 'item-1', productName: 'Product', ownerName: 'Owner',
      inventoryQuantity: 20, lastMonthUnits: 10, lastMonthDays: 31, lastMonthAvgDailySales: 10 / 31, lastMonthAvgPrice: 12,
      expectedDailySales: 2, sellingDays: 10, quantityTarget: 20, amountTarget: 240, missingReasons: [], formulaVersion: 'v1', status: 'draft',
    }]);
    const rows = await parseMonthlyTargetWorkbook(workbook);
    expect(rows[0]).toMatchObject({ month: '2026-11', storeId: 'store-1', sku: 'SKU-1', expectedDailySales: 2, quantityTarget: 20, amountTarget: 240 });
    expect(rows[0].quantityTargetFormula).toBe('=M2*L2');
    expect(rows[0].amountTargetFormula).toBe('=K2*N2');
  });
});
