import { expect, it } from 'vitest';
import { projectCommerceRows } from './commerce-source.js';

it('projects replayed raw pages into one current line and append-only status history', () => {
  const rows = [
    { id: '1', externalId: 'raw-order-1', tenantId: 't', storeId: 's', resource: 'orders', payload: { orders: [{ purchaseOrderId: 'o1', orderDate: '2026-01-01', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] } },
    { id: '2', externalId: 'raw-order-2', tenantId: 't', storeId: 's', resource: 'orders', payload: { orders: [{ purchaseOrderId: 'o1', orderDate: '2026-01-01', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'A' } }] } }] } },
    { id: '3', tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REQUESTED', refundAmount: { amount: 0 } }] }] } },
    { id: '4', tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REQUESTED', refundAmount: { amount: 0 } }] }] } },
    { id: '5', tenantId: 't', storeId: 's', resource: 'returns', payload: { returns: [{ returnOrderId: 'r1', purchaseOrderId: 'o1', returnDate: '2026-01-03', returnOrderLines: [{ lineNumber: '1', item: { sku: 'A' }, status: 'REFUNDED', refundAmount: { amount: 5 } }] }] } }
  ];
  const projection = projectCommerceRows(rows);
  expect(projection.orders.map((line) => ({ id: line.id, rawResponseId: line.rawResponseId }))).toEqual([{ id: 's:o1:1', rawResponseId: 'raw-order-2' }]);
  expect(projection.returns).toMatchObject([{ id: 's:r1:1', orderId: 's:o1', status: 'REFUNDED', amount: 5 }]);
  expect(projection.snapshots.map((snapshot) => snapshot.status)).toEqual(['REQUESTED', 'REFUNDED']);
  expect(projection.snapshots.map((snapshot) => snapshot.rawResponseId)).toEqual(['3', '5']);
});
