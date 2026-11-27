import { expect, it } from 'vitest';
import { validDateRange } from './DateRangePicker.js';

it('accepts empty and valid inclusive ranges', () => {
  expect(validDateRange('', '')).toBe(true);
  expect(validDateRange('', '2026-10-21')).toBe(true);
  expect(validDateRange('2026-10-21', '2026-10-21')).toBe(true);
});

it('rejects a reversed or impossible date range', () => {
  expect(validDateRange('2026-10-22', '2026-10-21')).toBe(false);
  expect(validDateRange('2026-02-30', '')).toBe(false);
});
