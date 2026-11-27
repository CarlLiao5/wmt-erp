import { describe, expect, it } from 'vitest';
import { calculateMonthlySkuTarget, importedTargetNumber, optionalTargetNumber, planMonthlyTargetInitialization, resolveImportedMonthlyTargets } from './monthlyTargets.js';

describe('optionalTargetNumber', () => {
  it('normalizes blank workbook cells to null without converting zero', () => {
    expect(optionalTargetNumber('')).toBeNull();
    expect(optionalTargetNumber(null)).toBeNull();
    expect(optionalTargetNumber(0)).toBe(0);
    expect(optionalTargetNumber('12.5')).toBe(12.5);
  });
});

describe('importedTargetNumber', () => {
  it('prefers the workbook value and falls back to the draft only for blank cells', () => {
    const workbookPrice = importedTargetNumber('155.99', '166.4727');
    expect(workbookPrice).toBe(155.99);
    expect(importedTargetNumber('', '24.99')).toBe(24.99);
    expect(importedTargetNumber(0, 24.99)).toBe(0);
    const target = calculateMonthlySkuTarget({ month: '2026-11', priorMonthUnits: 30, priorMonthRevenue: 30 * workbookPrice!, priorMonthDays: 30, inventoryQuantity: 100, expectedDailySales: 15, sellingDays: 30 });
    expect(target.amountTarget).toBeCloseTo(70195.5, 8);
  });
});

describe('resolveImportedMonthlyTargets', () => {
  it('preserves workbook target values when source sales are missing', () => {
    expect(resolveImportedMonthlyTargets(
      { quantityTarget: 3000, amountTarget: 53970 },
      { quantityTarget: null, amountTarget: null },
    )).toEqual({ quantityTarget: 3000, amountTarget: 53970 });
  });

  it('uses calculated values only when workbook targets are blank', () => {
    expect(resolveImportedMonthlyTargets(
      { quantityTarget: '', amountTarget: null },
      { quantityTarget: 12, amountTarget: 240 },
    )).toEqual({ quantityTarget: 12, amountTarget: 240 });
  });
});

describe('planMonthlyTargetInitialization', () => {
  it('creates a new draft revision when a finalized batch has lost its SKU rows', () => {
    expect(planMonthlyTargetInitialization({ id: 'batch-1', revision: 1, status: 'finalized' }, 0)).toEqual({ action: 'create', revision: 2 });
  });

  it('repairs an empty draft in place and reuses a batch that still has SKU rows', () => {
    expect(planMonthlyTargetInitialization({ id: 'draft-1', revision: 2, status: 'draft' }, 0)).toEqual({ action: 'repair', batchId: 'draft-1', revision: 2 });
    expect(planMonthlyTargetInitialization({ id: 'batch-1', revision: 1, status: 'finalized' }, 5)).toEqual({ action: 'reuse', batchId: 'batch-1', revision: 1 });
  });

  it('starts at revision one when the month has no batch', () => {
    expect(planMonthlyTargetInitialization(undefined, 0)).toEqual({ action: 'create', revision: 1 });
  });
});

describe('calculateMonthlySkuTarget', () => {
  it('calculates daily sales, capped selling days, quantity and amount', () => {
    const result = calculateMonthlySkuTarget({
      month: '2026-10',
      priorMonthUnits: 300,
      priorMonthRevenue: 4500,
      priorMonthDays: 30,
      inventoryQuantity: 500,
    });
    expect(result.lastMonthAvgDailySales).toBe(10);
    expect(result.lastMonthAvgPrice).toBe(15);
    expect(result.expectedDailySales).toBe(10);
    expect(result.sellingDays).toBe(31);
    expect(result.quantityTarget).toBe(310);
    expect(result.amountTarget).toBe(4650);
    expect(result.missingReasons).toEqual([]);
  });

  it('uses the inventory-limited selling days when inventory is below a month', () => {
    const result = calculateMonthlySkuTarget({ month: '2026-02', priorMonthUnits: 280, priorMonthRevenue: 2800, priorMonthDays: 31, inventoryQuantity: 70 });
    expect(result.monthDays).toBe(28);
    expect(result.sellingDays).toBeCloseTo(7.75);
    expect(result.quantityTarget).toBe(70);
    expect(result.amountTarget).toBe(700);
  });

  it('supports leap-year month lengths', () => {
    expect(calculateMonthlySkuTarget({ month: '2024-02', priorMonthUnits: 29, priorMonthRevenue: 29, priorMonthDays: 31, inventoryQuantity: 100 }).monthDays).toBe(29);
  });

  it('keeps missing sales or inventory explicit instead of fabricating targets', () => {
    const result = calculateMonthlySkuTarget({ month: '2026-10', priorMonthUnits: 0, priorMonthRevenue: 0, priorMonthDays: 30, inventoryQuantity: null });
    expect(result.lastMonthAvgDailySales).toBeNull();
    expect(result.lastMonthAvgPrice).toBeNull();
    expect(result.expectedDailySales).toBeNull();
    expect(result.sellingDays).toBeNull();
    expect(result.quantityTarget).toBeNull();
    expect(result.amountTarget).toBeNull();
    expect(result.missingReasons).toEqual(['上月无销量', '缺少在库库存', '缺少预计日销']);
  });

  it('recalculates from an edited expected daily sales value', () => {
    const result = calculateMonthlySkuTarget({ month: '2026-10', priorMonthUnits: 30, priorMonthRevenue: 300, priorMonthDays: 30, inventoryQuantity: 100, expectedDailySales: 5 });
    expect(result.expectedDailySales).toBe(5);
    expect(result.sellingDays).toBe(20);
    expect(result.quantityTarget).toBe(100);
    expect(result.amountTarget).toBe(1000);
  });

  it('uses explicitly supplied selling days as a fixed target input', () => {
    const result = calculateMonthlySkuTarget({ month: '2026-11', priorMonthUnits: 300, priorMonthRevenue: 45000, priorMonthDays: 30, inventoryQuantity: 100, expectedDailySales: 15, sellingDays: 30 });
    expect(result.sellingDays).toBe(30);
    expect(result.quantityTarget).toBe(450);
    expect(result.amountTarget).toBe(67500);
  });

  it('does not cap an imported fixed selling-days target by current inventory', () => {
    const result = calculateMonthlySkuTarget({ month: '2026-11', priorMonthUnits: 30, priorMonthRevenue: 3000, priorMonthDays: 30, inventoryQuantity: 2, expectedDailySales: 15, sellingDays: 30 });
    expect(result.sellingDays).toBe(30);
    expect(result.quantityTarget).toBe(450);
  });

  it('rejects malformed target months', () => {
    expect(() => calculateMonthlySkuTarget({ month: '2026/10', priorMonthUnits: 1, priorMonthRevenue: 1, priorMonthDays: 30, inventoryQuantity: 1 })).toThrow('month must use YYYY-MM format');
  });
});
