export const MONTHLY_TARGET_FORMULA_VERSION = '2026-10-21-v1';

export interface MonthlyTargetInput {
  month: string;
  priorMonthUnits: number | null | undefined;
  priorMonthRevenue: number | null | undefined;
  priorMonthDays?: number;
  inventoryQuantity: number | null | undefined;
  expectedDailySales?: number | null;
  sellingDays?: number | null;
  formulaVersion?: string;
}

export interface MonthlyTargetCalculation {
  month: string;
  formulaVersion: string;
  monthDays: number;
  priorMonthDays: number;
  lastMonthAvgDailySales: number | null;
  lastMonthAvgPrice: number | null;
  expectedDailySales: number | null;
  sellingDays: number | null;
  quantityTarget: number | null;
  amountTarget: number | null;
  missingReasons: string[];
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function optionalTargetNumber(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  return Number(value);
}

export function importedTargetNumber(workbookValue: unknown, draftValue: unknown): number | null {
  return optionalTargetNumber(workbookValue) ?? optionalTargetNumber(draftValue);
}

export function resolveImportedMonthlyTargets(
  workbook: { quantityTarget?: unknown; amountTarget?: unknown },
  calculated: { quantityTarget?: unknown; amountTarget?: unknown },
): { quantityTarget: number | null; amountTarget: number | null } {
  return {
    quantityTarget: importedTargetNumber(workbook.quantityTarget, calculated.quantityTarget),
    amountTarget: importedTargetNumber(workbook.amountTarget, calculated.amountTarget),
  };
}

export function planMonthlyTargetInitialization(
  existing: { id: string; revision: number; status: string } | undefined,
  rowCount: number,
): { action: 'create'; revision: number } | { action: 'repair' | 'reuse'; batchId: string; revision: number } {
  if (!existing) return { action: 'create', revision: 1 };
  if (rowCount > 0) return { action: 'reuse', batchId: existing.id, revision: existing.revision };
  if (existing.status === 'draft') return { action: 'repair', batchId: existing.id, revision: existing.revision };
  return { action: 'create', revision: existing.revision + 1 };
}

function daysInMonth(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('month must use YYYY-MM format');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month must use YYYY-MM format');
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function calculateMonthlySkuTarget(input: MonthlyTargetInput): MonthlyTargetCalculation {
  const monthDays = daysInMonth(input.month);
  const priorMonthDays = input.priorMonthDays ?? 0;
  const units = finiteNonNegative(input.priorMonthUnits);
  const revenue = finiteNonNegative(input.priorMonthRevenue);
  const inventory = finiteNonNegative(input.inventoryQuantity);
  const missingReasons: string[] = [];

  if (!units || units <= 0) missingReasons.push('上月无销量');
  if (inventory == null) missingReasons.push('缺少在库库存');
  if (priorMonthDays <= 0) missingReasons.push('缺少上月自然日天数');
  if (units != null && units > 0 && revenue == null) missingReasons.push('缺少上月销售金额');

  const lastMonthAvgDailySales = units != null && units > 0 && priorMonthDays > 0 ? units / priorMonthDays : null;
  const lastMonthAvgPrice = units != null && units > 0 && revenue != null ? revenue / units : null;
  const expected = input.expectedDailySales === undefined ? lastMonthAvgDailySales : finiteNonNegative(input.expectedDailySales);
  if (expected == null) missingReasons.push('缺少预计日销');

  let sellingDays: number | null = null;
  let quantityTarget: number | null = null;
  let amountTarget: number | null = null;
  const requestedSellingDays = input.sellingDays == null ? null : finiteNonNegative(input.sellingDays);
  if (input.sellingDays != null && requestedSellingDays == null) missingReasons.push('销售天数无效');
  if (expected != null && (inventory != null || requestedSellingDays != null)) {
    sellingDays = requestedSellingDays ?? (expected > 0 ? Math.min(monthDays, inventory! / expected) : 0);
    quantityTarget = sellingDays * expected;
    if (lastMonthAvgPrice != null) amountTarget = lastMonthAvgPrice * quantityTarget;
    else missingReasons.push('缺少上月均价');
  }

  return {
    month: input.month,
    formulaVersion: input.formulaVersion ?? MONTHLY_TARGET_FORMULA_VERSION,
    monthDays,
    priorMonthDays,
    lastMonthAvgDailySales,
    lastMonthAvgPrice,
    expectedDailySales: expected,
    sellingDays,
    quantityTarget,
    amountTarget,
    missingReasons: [...new Set(missingReasons)],
  };
}
