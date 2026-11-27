import { expect, it } from 'vitest';
import { dateRangeError, inclusiveDateEnd } from './date-range.js';

it('rejects a start date later than the end date', () => {
  expect(dateRangeError('2026-10-22', '2026-10-21')).toBe('开始日期不能晚于结束日期');
});

it('accepts an open-ended or ordered date range', () => {
  expect(dateRangeError(undefined, '2026-10-21')).toBeNull();
  expect(dateRangeError('2026-10-21', undefined)).toBeNull();
  expect(dateRangeError('2026-10-21', '2026-10-21')).toBeNull();
});

it('rejects invalid calendar dates', () => {
  expect(dateRangeError('2026-02-30', undefined)).toBe('日期格式无效');
});

it('includes the complete selected end date', () => {
  expect(inclusiveDateEnd('2026-10-21')?.toISOString()).toBe('2026-10-21T23:59:59.999Z');
  expect(inclusiveDateEnd(undefined)).toBeUndefined();
});
