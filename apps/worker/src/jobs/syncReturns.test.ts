import { expect, it } from 'vitest';
import { normalizeReturnPayload, replayReturnPages } from './syncReturns.js';

it('normalizes refund and status snapshots with raw response IDs', () => {
  const rows = normalizeReturnPayload({ returns: [{ returnOrderId: 'r1', customerOrderId: 'o1', returnDate: '2026-01-04T00:00:00Z', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REFUNDED', refundAmount: { amount: 5 } }] }] }, { tenantId: 't', storeId: 's', rawResponseId: 'raw-return' });
  expect(rows).toMatchObject([{ id: 's:r1:1', orderId: 's:o1', sku: 'A', status: 'REFUNDED', amount: 5, rawResponseId: 'raw-return' }]);
});

it('replays all return pages within an overlapping modified window', async () => {
  const queries: Array<Record<string, string>> = [];
  const rows = await replayReturnPages({ tenantId: 't', storeId: 's', from: '2026-01-04T00:00:00Z', to: '2026-01-05T00:00:00Z', overlapMs: 60_000 }, async (query) => {
    queries.push(query);
    return query.nextCursor ? { returns: [{ returnOrderId: 'r2', returnOrderLines: [{ lineNumber: '1', item: { sku: 'B' } }] }] } : { returns: [{ returnOrderId: 'r1', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' } }] }], nextCursor: 'next' };
  });
  expect(rows.map((row) => row.id)).toEqual(['s:r1:1', 's:r2:1']);
  expect(queries[0]).toMatchObject({ lastModifiedStartDate: '2026-01-03T23:59:00.000Z', lastModifiedEndDate: '2026-01-05T00:00:00Z' });
  expect(queries[1]?.nextCursor).toBe('next');
});
