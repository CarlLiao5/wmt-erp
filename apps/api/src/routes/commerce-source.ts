import { and, asc, eq, createDb, rawPayloads } from '@walmart-erp/db';
import { normalizeOrderPayload } from '../../../worker/src/jobs/syncOrders.js';
import { normalizeReturnPayload } from '../../../worker/src/jobs/syncReturns.js';
import type { OrderLine } from './orders.js';
import type { ReturnRecord } from './returns.js';

export interface RawCommerceRow { id: string | number; externalId?: string; tenantId: string; storeId: string; resource: string; payload: unknown; }
export interface ReturnSnapshot { id: string; returnId: string; status: string; refundAmount: number; returnedAt: string; rawResponseId: string; }
export interface CommerceSource { listOrders(tenantId: string): Promise<OrderLine[]>; listReturns(tenantId: string): Promise<ReturnRecord[]>; listReturnSnapshots?(tenantId: string): Promise<ReturnSnapshot[]>; }

export function projectCommerceRows(rows: RawCommerceRow[]) {
  const orders = new Map<string, ReturnType<typeof normalizeOrderPayload>[number]>();
  const returns = new Map<string, ReturnType<typeof normalizeReturnPayload>[number]>();
  const snapshots: ReturnSnapshot[] = [];
  const latestSnapshot = new Map<string, string>();
  const seenRaw = new Set<string>();
  for (const row of rows) {
    const context = { tenantId: row.tenantId, storeId: row.storeId, rawResponseId: row.externalId ?? String(row.id) };
    if (row.resource === 'orders') {
      for (const line of normalizeOrderPayload(row.payload, context)) orders.set(line.id, line);
    } else if (row.resource === 'returns') {
      if (seenRaw.has(`${row.tenantId}:${row.storeId}:${context.rawResponseId}`)) continue;
      seenRaw.add(`${row.tenantId}:${row.storeId}:${context.rawResponseId}`);
      for (const line of normalizeReturnPayload(row.payload, context)) {
        returns.set(line.id, line);
        const state = `${line.status}:${line.amount}:${line.returnedAt}`;
        if (latestSnapshot.get(line.id) !== state) {
          snapshots.push({ id: `${line.id}:${context.rawResponseId}`, returnId: line.id, status: line.status, refundAmount: line.amount, returnedAt: line.returnedAt, rawResponseId: line.rawResponseId });
          latestSnapshot.set(line.id, state);
        }
      }
    }
  }
  return { orders: [...orders.values()], returns: [...returns.values()], snapshots };
}

export function mysqlCommerceSource(): CommerceSource {
  const { db } = createDb();
  const load = async (tenantId: string) => {
    const rows = await db.select({ id: rawPayloads.id, externalId: rawPayloads.externalId, tenantId: rawPayloads.tenantId, storeId: rawPayloads.storeId, resource: rawPayloads.resource, payload: rawPayloads.payload }).from(rawPayloads).where(and(eq(rawPayloads.tenantId, tenantId))).orderBy(asc(rawPayloads.id));
    return projectCommerceRows(rows);
  };
  return { listOrders: async (tenantId) => (await load(tenantId)).orders, listReturns: async (tenantId) => (await load(tenantId)).returns, listReturnSnapshots: async (tenantId) => (await load(tenantId)).snapshots };
}

export class CommerceUnavailableError extends Error { constructor() { super('Commerce data source is not configured'); } }
export function unavailableCommerceSource(): CommerceSource {
  const unavailable = async (): Promise<never> => { throw new CommerceUnavailableError(); };
  return { listOrders: unavailable, listReturns: unavailable, listReturnSnapshots: unavailable };
}
