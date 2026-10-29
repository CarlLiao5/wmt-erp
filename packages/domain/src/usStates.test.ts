import { describe, expect, it } from 'vitest';
import { US_STATES_48 } from './usStates.js';

describe('US_STATES_48', () => {
  it('contains exactly 48 unique contiguous states with representative coordinates', () => {
    expect(US_STATES_48).toHaveLength(48);
    expect(new Set(US_STATES_48.map((state) => state.code)).size).toBe(48);
    expect(US_STATES_48.every((state) => state.latitude >= 24 && state.latitude <= 50)).toBe(true);
    expect(US_STATES_48.every((state) => state.longitude >= -125 && state.longitude <= -66)).toBe(true);
    expect(US_STATES_48.find((state) => state.code === 'CA')).toMatchObject({ name: 'California' });
    expect(US_STATES_48.find((state) => state.code === 'TX')).toMatchObject({ name: 'Texas' });
    expect(US_STATES_48.some((state) => state.code === 'AK')).toBe(false);
    expect(US_STATES_48.some((state) => state.code === 'HI')).toBe(false);
  });
});
