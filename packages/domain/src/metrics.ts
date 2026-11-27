export interface DailyMetricInput { revenue: number; units: number; orders: number; refunds: number; adSpend: number | null; productCost: number | null; fulfillmentCost: number | null; }
export interface DailyMetrics extends DailyMetricInput { formulaVersion: string; returnRate: number; acos: number | null; roas: number | null; profit: number | null; estimated: boolean; missing: string[]; }
export function calculateDailyMetrics(input: DailyMetricInput, formulaVersion = 'v1'): DailyMetrics {
  const missing = (['adSpend', 'productCost', 'fulfillmentCost'] as const).filter((key) => input[key] == null);
  const estimated = missing.length > 0;
  const acos = input.adSpend == null || input.revenue === 0 ? null : input.adSpend / input.revenue;
  const roas = input.adSpend == null || input.adSpend === 0 ? null : input.revenue / input.adSpend;
  const profit = estimated ? null : input.revenue - input.refunds - (input.productCost ?? 0) - (input.fulfillmentCost ?? 0) - (input.adSpend ?? 0);
  return { ...input, formulaVersion, returnRate: input.revenue ? input.refunds / input.revenue : 0, acos, roas, profit, estimated, missing };
}
