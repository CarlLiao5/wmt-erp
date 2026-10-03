import { expect, it } from 'vitest'; import { marketingMetrics } from './performance.js'; it('calculates acos and roas', () => expect(marketingMetrics(200, 50)).toEqual({ acos: 0.25, roas: 4 }));
