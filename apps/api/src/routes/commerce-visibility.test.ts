import { expect, it } from 'vitest';
import { resolveCommerceVisibility } from './commerce-visibility.js';

it('uses active tenant assignments and restricts customer fields by scope', async () => {
  const assignments = [
    { tenantId: 't', userId: 'u', storeId: 's1', validFrom: new Date('2025-01-01') },
    { tenantId: 't', userId: 'u', skuId: 'sku-1', sku: 'A', skuStoreId: 's2', validFrom: new Date('2025-01-01') },
    { tenantId: 't', userId: 'u', skuId: 'sku-old', sku: 'B', validFrom: new Date('2025-01-01'), validUntil: new Date('2026-01-01') },
    { tenantId: 'other', userId: 'u', storeId: 'secret', validFrom: new Date('2025-01-01') }
  ];
  const resolve = async () => assignments;
  const member = await resolveCommerceVisibility({ tenantId: 't', userId: 'u', role: 'member' }, resolve, new Date('2026-02-01'));
  expect([...member.storeIds]).toEqual(['s1']);
  expect([...member.skus]).toEqual(['s2:A']);
  expect([...member.customerFields!]).toEqual(['name']);
  const skuOnly = await resolveCommerceVisibility({ tenantId: 't', userId: 'u', role: 'member' }, async () => assignments.slice(1, 2), new Date('2026-02-01'));
  expect([...skuOnly.customerFields!]).toEqual([]);
  const admin = await resolveCommerceVisibility({ tenantId: 't', userId: 'admin', role: 'admin' }, async () => []);
  expect(admin.role).toBe('admin');
  expect(admin.customerFields?.has('email')).toBe(true);
});
