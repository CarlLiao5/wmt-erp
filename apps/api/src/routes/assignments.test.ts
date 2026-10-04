import { expect, it } from 'vitest';
import { reassignOwner } from './assignments.js';
it('reassigns only the selected store or SKU scope', () => { const rows = reassignOwner([{ memberId: 'old', storeId: 's1' }, { memberId: 'old', sku: 'A' }, { memberId: 'keep', sku: 'B' }], { sku: 'A' }, 'new'); expect(rows.map((x) => x.memberId)).toEqual(['old', 'new', 'keep']); });
