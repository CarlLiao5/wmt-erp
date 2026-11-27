import { expect, it } from 'vitest';
import { isCancelledOrderStatus } from './orderStatus.js';

it('recognizes cancelled status variants without excluding any other status', () => {
  expect(isCancelledOrderStatus('Cancelled')).toBe(true);
  expect(isCancelledOrderStatus(' CANCELED ')).toBe(true);
  for (const status of ['Acknowledged', 'Created', 'Shipped', 'Delivered', 'Dispensed', 'UNKNOWN', null, undefined]) {
    expect(isCancelledOrderStatus(status)).toBe(false);
  }
});
