import { expect, it } from 'vitest';
import { createCommerceRawWriter } from './commerceRawStore.js';

it('appends immutable raw pages with tenant, store and resource provenance', async () => {
  const records: unknown[] = [];
  const write = createCommerceRawWriter(async (row) => { records.push(row); });
  const payload = { orders: [{ purchaseOrderId: 'o1' }] };
  await write({ tenantId: 't', storeId: 's', resource: 'orders' }, payload, 'raw-1');
  payload.orders[0].purchaseOrderId = 'changed';
  expect(records).toMatchObject([{ tenantId: 't', storeId: 's', resource: 'orders', externalId: 'raw-1', correlationId: 'raw-1', httpStatus: 200, payload: { orders: [{ purchaseOrderId: 'o1' }] } }]);
});
