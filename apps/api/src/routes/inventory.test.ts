import { expect, it } from 'vitest';
import { inventoryAge, reconcileInventory } from './inventory.js';
it('calculates age and reconciliation delta', () => { expect(inventoryAge('2026-01-01', new Date('2026-01-03'))).toBe(2); expect(reconcileInventory([{ storeId: 's', sku: 'x', quantity: 5, updatedAt: '' }], [{ storeId: 's', sku: 'x', quantity: 3, updatedAt: '' }])[0].delta).toBe(-2); });
