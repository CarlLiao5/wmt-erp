import { describe, expect, it } from 'vitest';
import { buildOrdersQuery, MAX_ORDER_PAGE_SIZE } from './orders.js';

describe('orders adapter query limits', () => {
  it('clamps every order page to Walmart maximum 200', () => {
    expect(MAX_ORDER_PAGE_SIZE).toBe(200);
    expect(buildOrdersQuery({ createdStartDate: '2026-04-19', createdEndDate: '2026-04-20', limit: '500' })).toEqual({
      createdStartDate: '2026-04-19',
      createdEndDate: '2026-04-20',
      limit: '200',
    });
  });
});
