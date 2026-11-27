import { walmartGet } from '../transport.js';
import type { WalmartConnection } from '../types.js';

export interface SellerPerformanceRow {
  metric: string;
  value: number | null;
  complete: boolean;
}

const WINDOW_NAMES = new Set(['7DAY', '14DAY', '30DAY', '60DAY', '90DAY']);

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '' || Number.isNaN(Number(value))) return null;
  return Number(value);
}

/** Expands Walmart's rolling-window seller performance response into snapshot rows. */
export function normalizeSellerPerformanceRows(payload: unknown): SellerPerformanceRow[] {
  const body = payload as any;
  const windows = body?.payload ?? body?.data?.payload ?? body?.data ?? body;
  if (!windows || typeof windows !== 'object' || Array.isArray(windows)) return [];

  return Object.entries(windows)
    .filter(([window]) => WINDOW_NAMES.has(window))
    .flatMap(([window, metrics]) => {
      if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return [];
      return Object.entries(metrics as Record<string, unknown>).map(([metric, value]) => {
        const normalized = numberOrNull(value);
        return { metric: `${window}.${metric}`, value: normalized, complete: normalized != null };
      });
    });
}

/** Reads the account-level Seller Performance Report (rolling 7/14/30/60/90 day windows). */
export async function* listPerformance(
  connection: WalmartConnection,
  _query: Record<string, string> = {},
  fetcher?: typeof fetch,
) {
  const response = await walmartGet<unknown>(connection, '/v3/report/payment/performance', { fetcher });
  yield response.data;
}
