import {reportWait,reportCooldown,hasReportContinuation} from './reportContinuation.js';
import { assertReadOnly } from './readonly.js';
import type { WalmartConnection } from './types.js';

interface RequestBucket {
  nextAllowedAt: number;
  cooldownUntil: number;
  tail: Promise<void>;
}

const requestBuckets = new Map<string, RequestBucket>();

function replenishmentTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return timestamp > Date.now() ? timestamp : undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : undefined;
}

function retryTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const timestamp = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : undefined;
}

function requestPolicy(path: string): { key: string; intervalMs: number } | undefined {
  if (path === '/v3/token') return undefined;
  // Pace at no more than half of the published defaults; response headers can slow it further.
  if (/\/v3\/orders(?:\/|$)/.test(path)) return { key: 'orders', intervalMs: 24 };
  if (/\/v3\/returns(?:\/|$)/.test(path)) return { key: 'returns', intervalMs: 2_400 };
  if (path === '/v3/fulfillment/inbound-preview') return { key: 'inbound-preview', intervalMs: 10_000 };
  if (path === '/v3/fulfillment/inventory-log') return { key: 'inventory-log', intervalMs: 240 };
  if (path === '/v3/report/payment/performance') return { key: 'performance', intervalMs: 8_000 };
  if (path === '/v3/price/getPricingInsights') return { key: 'price-insights', intervalMs: 60_000 };
  if (path === '/v3/price/incentives') return { key: 'price-incentives', intervalMs: 2_000 };
  if (/\/v3\/promo\/sku\//.test(path)) return { key: 'promotion', intervalMs: 120 };
  if (path === '/v3/advertising/sem/campaigns/performance-summary') return { key: 'sem-summary', intervalMs: 12_000 };
  if (/\/v3\/reports\/(?:reportRequests|downloadReport)/.test(path)) return { key: 'reports', intervalMs: 360_000 };
  if (/\/v3\//.test(path)) return { key: `serial:${path.split('/').slice(1, 4).join('/')}`, intervalMs: 0 };
  return undefined;
}

async function lockRequestBucket(bucket: RequestBucket): Promise<() => void> {
  const previous = bucket.tail;
  let release!: () => void;
  bucket.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}

export async function walmartRequest(
  connection: WalmartConnection,
  path: string | URL,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  timeoutMs = 120_000,
): Promise<Response> {
  const url = path instanceof URL ? path : new URL(path, connection.baseUrl);
  const method = String(init.method ?? 'GET').toUpperCase();
  assertReadOnly(method, `${url.pathname}${url.search}`, init.body);
  const policy = url.origin === new URL(connection.baseUrl).origin ? requestPolicy(url.pathname) : undefined;
  const fetchWithTimeout = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Walmart request timed out', 'TimeoutError')), timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    try {
      return await fetcher(url, { ...init, method, signal });
    } finally {
      clearTimeout(timer);
    }
  };
  if (!policy) return fetchWithTimeout();

  const key = `${connection.environment}:${connection.clientId}:${policy.key}`;
  const bucket = requestBuckets.get(key) ?? { nextAllowedAt: 0, cooldownUntil: 0, tail: Promise.resolve() };
  requestBuckets.set(key, bucket);
  const release = await lockRequestBucket(bucket);
  try {
    const durableCooldown = policy.key === 'reports' ? await reportCooldown(key) : 0;
    const waitUntil = Math.max(bucket.nextAllowedAt, bucket.cooldownUntil, durableCooldown);
    const waitMs = waitUntil - Date.now();
    if (waitMs > 0) {
      if (policy.key === 'reports' && hasReportContinuation()) await reportWait(waitMs, 'api-cooldown');
      else await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    bucket.nextAllowedAt = Math.max(Date.now(), bucket.nextAllowedAt) + policy.intervalMs;
    if (policy.key === 'reports') await reportCooldown(key, bucket.nextAllowedAt);
    const response = await fetchWithTimeout();
    const tokenCount = response.headers.get('x-current-token-count');
    const currentTokens = tokenCount === null ? Number.NaN : Number(tokenCount);
    const replenishmentAt = replenishmentTimestamp(response.headers.get('x-next-replenishment-time'));
    const retryAt = retryTimestamp(response.headers.get('retry-after'));
    if (Number.isFinite(currentTokens) && currentTokens <= 0 && replenishmentAt) {
      bucket.cooldownUntil = Math.max(bucket.cooldownUntil, replenishmentAt);
    }
    if (response.status === 429) {
      if (replenishmentAt) bucket.cooldownUntil = Math.max(bucket.cooldownUntil, replenishmentAt);
      if (retryAt) bucket.cooldownUntil = Math.max(bucket.cooldownUntil, retryAt);
    }
    if (policy.key === 'reports') await reportCooldown(key, Math.max(bucket.nextAllowedAt,bucket.cooldownUntil));
    return response;
  } finally {
    release();
  }
}
