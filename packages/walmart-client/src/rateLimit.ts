export function retryDelay(attempt: number, retryAfter?: string | null): number { const parsed = retryAfter ? Number(retryAfter) * 1000 : 250 * 2 ** attempt; return Math.min(Number.isFinite(parsed) ? parsed : 1000, 30_000); }
export function isRetryable(status: number): boolean { return status === 401 || status === 429 || status >= 500; }
