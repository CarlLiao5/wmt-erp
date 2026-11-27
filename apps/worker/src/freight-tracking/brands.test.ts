import { describe, expect, it } from 'vitest';
import { brandForInboundNumber } from './brands.js';

describe('brandForInboundNumber', () => {
  it.each([
    ['QT10002818', 'qitexp'],
    [' tt10002818 ', 'skytuo'],
    ['DSL-10002818', 'desu'],
    ['YLD10002818', 'depaex'],
    ['DP10002818', 'depaex'],
  ])('maps %s to %s', (number, brand) => {
    expect(brandForInboundNumber(number)).toBe(brand);
  });

  it('returns undefined for empty and unsupported prefixes', () => {
    expect(brandForInboundNumber('')).toBeUndefined();
    expect(brandForInboundNumber('OTHER-10002818')).toBeUndefined();
  });
});
