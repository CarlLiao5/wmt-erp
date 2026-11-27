import { randomUUID } from 'node:crypto';
import { WalmartHttpError } from './errors.js';
import { isRetryable, retryDelay } from './rateLimit.js';
import type { WalmartConnection, WalmartResponse } from './types.js';
import { getAccessToken } from './auth/token.js';
import { walmartRequest } from './request.js';
export async function walmartGet<T>(connection: WalmartConnection, path: string, options: { query?: Record<string,string>; fetcher?: typeof fetch; maxAttempts?: number } = {}): Promise<WalmartResponse<T>> {
  const fetcher = options.fetcher ?? fetch;
  const correlationId = randomUUID();
  const url = new URL(path, connection.baseUrl);
  Object.entries(options.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  let token = connection.accessToken;
  let attempts = 0;
  const max = options.maxAttempts ?? 3;

  while (attempts < max) {
    if (!token || (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt < Date.now() + 60_000)) {
      token = (await getAccessToken(connection, fetcher)).accessToken;
    }

    let response: Response;
    try {
      response = await walmartRequest(connection, url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(connection.environment === 'sandbox' ? { 'WM_SANDBOX': 'v2' } : {}),
          Authorization: `Bearer ${token}`,
          'WM_SEC.ACCESS_TOKEN': token,
          'WM_QOS.CORRELATION_ID': correlationId,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_MARKET': 'us',
          'WM_GLOBAL_VERSION': '3.1',
        },
      }, fetcher);
    } catch (error) {
      attempts++;
      const message = error instanceof Error ? error.message : String(error);
      if (attempts >= max) throw new Error(`Walmart network request failed for ${url.pathname}: ${message}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempts - 1)));
      continue;
    }

    if (response.status === 204) {
      return { data: {} as T, status: response.status, correlationId, headers: response.headers };
    }

    if (response.ok) {
      const body = await response.text();
      try {
        return { data: JSON.parse(body) as T, status: response.status, correlationId, headers: response.headers };
      } catch (error) {
        attempts++;
        const bodyBytes = new TextEncoder().encode(body).byteLength;
        const detail = `Invalid JSON from ${url.pathname} (HTTP ${response.status}, ${bodyBytes} bytes)`;
        if (attempts >= max) {
          throw new Error(`${detail}: ${error instanceof Error ? error.message : 'Malformed JSON'}`);
        }
        const delay = retryDelay(attempts - 1, response.headers.get('retry-after'), response.headers.get('x-next-replenishment-time'));
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }

    attempts++;
    if (!isRetryable(response.status) || attempts >= max) {
      throw new WalmartHttpError(response.status, `Walmart request failed: ${response.status}`, Number(response.headers.get('retry-after') ?? 0) || undefined);
    }
    if (response.status === 401) token = undefined;
    const delay = retryDelay(attempts - 1, response.headers.get('retry-after'), response.headers.get('x-next-replenishment-time'));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error('Walmart request exhausted retries');
}
