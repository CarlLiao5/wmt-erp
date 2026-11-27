export function retryDelay(attempt: number, retryAfter?: string | null, nextReplenishment?: string | null): number {
  const retryNumeric = retryAfter ? Number(retryAfter) : NaN;
  const retryDate = retryAfter && !Number.isFinite(retryNumeric) ? Date.parse(retryAfter) - Date.now() : NaN;
  const retryMs = Number.isFinite(retryNumeric) ? retryNumeric * 1000 : retryDate;
  const replenishMs = nextReplenishment ? (() => {
    const numeric = Number(nextReplenishment);
    if (Number.isFinite(numeric)) {
      if (numeric > 1_000_000_000_000) return numeric - Date.now();
      if (numeric > 1_000_000_000) return numeric * 1000 - Date.now();
      return numeric * 1000;
    }
    const parsed = Date.parse(nextReplenishment);
    return Number.isFinite(parsed) ? parsed - Date.now() : NaN;
  })() : NaN;
  const serverWaits = [replenishMs, retryMs].filter((value) => Number.isFinite(value) && value > 0);
  return serverWaits.length ? Math.max(...serverWaits) : Math.min(250 * 2 ** attempt, 120_000);
}
export function retryAfterDelay(response: Pick<Response, 'headers'>): number {
  return retryDelay(0, response.headers.get('retry-after'), response.headers.get('x-next-replenishment-time'));
}
export function isRetryable(status: number): boolean { return status === 401 || status === 429 || status >= 500; }
