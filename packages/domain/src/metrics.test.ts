import { describe, expect, it } from 'vitest';
import { calculateDailyMetrics } from './metrics.js';

describe('calculateDailyMetrics', () => {
  it('calculates core ratios and exact profit when costs are complete', () => {
    expect(calculateDailyMetrics({ revenue: 100, units: 10, orders: 4, refunds: 10, adSpend: 20, productCost: 30, fulfillmentCost: 5 }, 'v1')).toMatchObject({ revenue: 100, units: 10, returnRate: 0.1, acos: 0.2, roas: 5, profit: 35, estimated: false, formulaVersion: 'v1' });
  });
  it('marks profit estimated and does not treat missing cost as zero', () => {
    const result = calculateDailyMetrics({ revenue: 100, units: 10, orders: 4, refunds: 10, adSpend: null, productCost: null, fulfillmentCost: 5 }, 'v1');
    expect(result.profit).toBeNull();
    expect(result.estimated).toBe(true);
    expect(result.missing).toContain('productCost');
  });
});
