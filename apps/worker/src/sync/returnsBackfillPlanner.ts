import { listReturnsPage } from '@walmart-erp/walmart-client';
import type { WalmartConnection } from '@walmart-erp/walmart-client';

export interface DateWindow { from: string; to: string; }
export interface ReturnsProbeResult { count: number; earliestDate?: string; unsupportedBefore?: string; }
export interface ReturnsBoundaryOptions {
  windowDays?: number;
  emptyWindowLimit?: number;
  probe?: (window: DateWindow) => Promise<ReturnsProbeResult>;
}

const DAY_MS = 86_400_000;
const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);
const parseDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const shift = (value: string, days: number): string => dateOnly(new Date(parseDate(value).getTime() + days * DAY_MS));

function payloadRows(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as Record<string, unknown>;
  for (const value of [body.returns, body.returnOrders, body.data]) if (Array.isArray(value)) return value;
  return [];
}

export function returnsCreationQuery(window: DateWindow): Record<string, string> {
  const start = window.from.length === 10 ? `${window.from}T00:00:00Z` : window.from;
  const end = window.to.length === 10 ? `${window.to}T23:59:59Z` : window.to;
  return { returnCreationStartDate: start, returnCreationEndDate: end, limit: '200' };
}

function earliestPayloadDate(rows: unknown[]): string | undefined {
  const dates = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    const candidate = value.returnDate ?? value.createdDate ?? value.lastModifiedDate;
    return typeof candidate === 'string' && !Number.isNaN(Date.parse(candidate)) ? [candidate.slice(0, 10)] : [];
  });
  return dates.sort()[0];
}

export async function discoverReturnsBoundary(connection: WalmartConnection, now: Date, options: ReturnsBoundaryOptions = {}): Promise<{ earliestAvailable: string; evidence: string }> {
  const windowDays = options.windowDays ?? 180;
  const emptyWindowLimit = options.emptyWindowLimit ?? 2;
  if (windowDays <= 0 || emptyWindowLimit <= 0) throw new Error('Returns probe limits must be positive');
  const probe = options.probe ?? (async (window: DateWindow): Promise<ReturnsProbeResult> => {
    const response = await listReturnsPage(connection, returnsCreationQuery(window));
    const rows = payloadRows(response.data);
    return { count: rows.length, earliestDate: earliestPayloadDate(rows) };
  });
  let cursor = dateOnly(now);
  let emptyWindows = 0;
  let lastRecord: { date: string; window: DateWindow } | undefined;
  for (let attempt = 0; attempt < 365; attempt += 1) {
    const window = { from: shift(cursor, -(windowDays - 1)), to: cursor };
    const result = await probe(window);
    if (result.unsupportedBefore) return { earliestAvailable: result.unsupportedBefore, evidence: `API boundary reported ${result.unsupportedBefore}` };
    if (result.count > 0) {
      emptyWindows = 0;
      lastRecord = { date: result.earliestDate ?? window.from, window };
    } else {
      emptyWindows += 1;
      if (emptyWindows >= emptyWindowLimit && lastRecord) return { earliestAvailable: lastRecord.date, evidence: `records returned in ${lastRecord.window.from}..${lastRecord.window.to}` };
    }
    cursor = shift(window.from, -1);
  }
  if (lastRecord) return { earliestAvailable: lastRecord.date, evidence: `probe limit reached after records in ${lastRecord.window.from}..${lastRecord.window.to}` };
  throw new Error('Returns history boundary could not be established');
}

export function planReturnsIncremental(now: Date, overlapDays = 7): DateWindow {
  if (overlapDays <= 0) throw new Error('Returns overlap must be positive');
  return { from: new Date(now.getTime() - overlapDays * DAY_MS).toISOString(), to: now.toISOString() };
}
