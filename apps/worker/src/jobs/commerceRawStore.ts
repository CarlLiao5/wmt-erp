import { createDb, rawPayloads } from '../../../../packages/db/index.js';
import type { WalmartConnection } from '@walmart-erp/walmart-client';
import { syncOrders, type ReplayWindow } from './syncOrders.js';
import { syncReturns, type ReturnWindow } from './syncReturns.js';

export interface RawPageRecord { tenantId: string; storeId: string; resource: 'orders' | 'returns'; externalId: string; payload: unknown; httpStatus: number; correlationId: string; receivedAt: Date; }
export function createCommerceRawWriter(append: (row: RawPageRecord) => Promise<void>) {
  return async (scope: Pick<RawPageRecord, 'tenantId' | 'storeId' | 'resource'>, payload: unknown, rawResponseId: string) => {
    await append({ ...scope, externalId: rawResponseId, payload: structuredClone(payload), httpStatus: 200, correlationId: rawResponseId, receivedAt: new Date() });
  };
}

function databaseWriter() {
  const { db } = createDb();
  return createCommerceRawWriter(async (row) => { await db.insert(rawPayloads).values(row); });
}

export async function syncOrdersToDatabase(window: ReplayWindow, connection: WalmartConnection) {
  const write = databaseWriter();
  return syncOrders(window, connection, (payload, id) => write({ tenantId: window.tenantId, storeId: window.storeId, resource: 'orders' }, payload, id), async () => {});
}

export async function syncReturnsToDatabase(window: ReturnWindow, connection: WalmartConnection) {
  const write = databaseWriter();
  return syncReturns(window, connection, (payload, id) => write({ tenantId: window.tenantId, storeId: window.storeId, resource: 'returns' }, payload, id), async () => {});
}
