import { paginate } from '../pagination.js';
import { getAvailableReconReportDates, getReconReportPage, reconNextOffset, reconTransactionRows } from './storageFees.js';
import type { WalmartConnection } from '../types.js';

export const listExistingReports = (c: WalmartConnection, q: Record<string,string>={}) => paginate<unknown>(c, '/v3/reports', q);

export interface ReconPeriod { reportDate: string; }
export async function listAvailableReconPeriods(connection: WalmartConnection, fetcher?: typeof fetch): Promise<ReconPeriod[]> {
  return (await getAvailableReconReportDates(connection, fetcher)).map((reportDate) => ({ reportDate }));
}

export async function* listReconRows(connection: WalmartConnection, period: ReconPeriod, fetcher?: typeof fetch): AsyncIterable<Record<string, unknown>> {
  let offset = 0;
  while (true) {
    const response = await getReconReportPage(connection, period.reportDate, offset, 1000, fetcher);
    const body = response.data as Record<string, unknown>;
    const directRows = [body.reportData, body.reportDetails, body.data].find(Array.isArray) as unknown[] | undefined;
    const rows = directRows?.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') ?? reconTransactionRows(response.data);
    for (const row of rows) yield row;
    const nextOffset = reconNextOffset(response.data, offset, 1000);
    if (nextOffset === undefined || nextOffset <= offset) return;
    offset = nextOffset;
  }
}
