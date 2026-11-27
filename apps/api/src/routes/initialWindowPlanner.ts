import { randomUUID } from 'node:crypto';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

const RESOURCE_LOOKBACK_DAYS: Record<string, number> = {
  orders: 180,
  returns: 365,
  inventory: 365,
  'storage-fees': 365,
  pricing: 30,
  advertising: 30,
  'advertising-onsite': 30,
  'advertising-sem': 30,
  'advertising-sem-items': 30,
  'advertising-sem-performance': 30,
  'advertising-sem-search-terms': 30,
  performance: 30,
};

export interface InitialWindowInsert {
  id: string;
  planId: string;
  tenantId: string;
  storeId: string;
  resource: string;
  batchId: string;
  windowFrom: Date;
  windowTo: Date;
  status: 'planned';
  createdAt: Date;
  updatedAt: Date;
}

export interface InitialWindowPlanInput {
  planId: string;
  tenantId: string;
  storeId: string;
  resource: string;
  mode: 'initial' | 'incremental';
  now: Date;
  requestedFrom?: string;
  requestedTo?: string;
}

function utcDay(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid sync window date: ${value}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function planInitialWindows(input: InitialWindowPlanInput): InitialWindowInsert[] {
  if (input.mode !== 'initial') return [];
  if (input.resource === 'inventory-recon') {
    const current = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), 1));
    const from = input.requestedFrom ? utcDay(input.requestedFrom) : new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    const to = input.requestedTo ? utcDay(input.requestedTo) : new Date(current.getTime() - 1);
    const windows: InitialWindowInsert[] = [];
    for (let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); cursor <= to && cursor < current; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
      if (windows.length >= 120) throw Error('Inventory reconciliation backfill exceeds 120 months');
      const month = cursor.toISOString().slice(0, 7);
      windows.push({id:randomUUID(),planId:input.planId,tenantId:input.tenantId,storeId:input.storeId,resource:input.resource,
        batchId:'initial:' + input.planId + ':' + month,
        windowFrom:new Date(cursor),windowTo:new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1)-1),
        status:'planned',createdAt:new Date(input.now),updatedAt:new Date(input.now)});
    }
    return windows;
  }
  const now = utcDay(input.now);
  const lookbackDays = RESOURCE_LOOKBACK_DAYS[input.resource] ?? 30;
  const requestedTo = input.requestedTo ? utcDay(input.requestedTo) : now;
  const requestedFrom = input.requestedFrom ? utcDay(input.requestedFrom) : new Date(now.getTime() - lookbackDays * DAY_MS);
  const earliestAllowed = new Date(now.getTime() - lookbackDays * DAY_MS);
  const from = new Date(Math.max(requestedFrom.getTime(), earliestAllowed.getTime()));
  const to = new Date(Math.min(requestedTo.getTime(), now.getTime()));
  if (from > to) return [];

  const createdAt = new Date(input.now);
  const windows: InitialWindowInsert[] = [];
  let cursor = from;
  while (cursor <= to) {
    const windowTo = new Date(Math.min(cursor.getTime() + (WINDOW_DAYS - 1) * DAY_MS, to.getTime()));
    const key = `${input.planId}:${dateKey(cursor)}:${dateKey(windowTo)}`;
    windows.push({
      id: randomUUID(),
      planId: input.planId,
      tenantId: input.tenantId,
      storeId: input.storeId,
      resource: input.resource,
      batchId: `initial:${key}`.slice(0, 64),
      windowFrom: cursor,
      windowTo,
      status: 'planned',
      createdAt,
      updatedAt: createdAt,
    });
    cursor = new Date(windowTo.getTime() + DAY_MS);
  }
  return windows;
}
