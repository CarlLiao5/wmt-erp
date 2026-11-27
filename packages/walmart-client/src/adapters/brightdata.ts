export interface BrightDataConfig {
  apiKey: string;
  zone: string;
  endpoint?: string;
  timeoutMs?: number;
  intervalMs?: number;
  maxRetries?: number;
}

export const DEFAULT_BRIGHTDATA_INTERVAL_MS = 3_000;

export function brightDataIntervalMs(config: Pick<BrightDataConfig, 'intervalMs'>): number {
  return config.intervalMs == null || !Number.isFinite(config.intervalMs) ? DEFAULT_BRIGHTDATA_INTERVAL_MS : Math.max(0, config.intervalMs);
}

export interface BrightDataProduct {
  itemId: string;
  productName: string | null;
  availableQuantity: number | null;
  price: number | null;
  description: string | null;
  rating: number | null;
  reviewCount: number | null;
  rawPayload: string;
}

export class BrightDataHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, message = `Bright Data request failed (${status})`) {
    super(message);
    this.name = 'BrightDataHttpError';
    this.status = status;
    this.retryable = status >= 500;
  }
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const text = (value: unknown): string | null => {
  const result = String(value ?? '').replace(/\s+/g, ' ').trim();
  return result || null;
};
const numberFrom = (value: unknown): number | null => {
  if (value == null) return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const result = Number(match[0]);
  return Number.isFinite(result) ? result : null;
};
function unescapeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function field(html: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`(?:[\\\"']${name}[\\\"']\\s*[:=]\\s*(?:[\\\"']([^\\\"']+)[\\\"']|([^,}\\s]+))|itemprop=[\\\"']${name}[\\\"'][^>]*content=[\\\"']([^\\\"']+))`, 'i');
    const match = html.match(pattern);
    if (match) return text(unescapeHtml(match[1] ?? match[2] ?? match[3] ?? ''));
  }
  return null;
}

export function parseBrightDataProduct(itemId: string, html: string): BrightDataProduct {
  const source = unescapeHtml(String(html ?? ''));
  const productName = field(source, ['name', 'productName']) ?? text(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = field(source, ['description']) ?? text(source.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1]);
  const price = numberFrom(field(source, ['price', 'currentPrice']) ?? source.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1]);
  const rating = numberFrom(field(source, ['ratingValue', 'rating', 'averageRating']));
  const reviewCount = numberFrom(field(source, ['reviewCount', 'ratingCount', 'reviewsCount']));
  const quantity = numberFrom(field(source, ['availableQuantity', 'inventory', 'quantity', 'stock', 'availabilityQuantity']));
  return { itemId, productName, availableQuantity: quantity, price, description, rating, reviewCount, rawPayload: source };
}

export async function fetchBrightDataHtml(url: string, config: BrightDataConfig, fetcher: typeof fetch = fetch, delay: (milliseconds: number) => Promise<void> = sleep): Promise<string> {
  if (!config.apiKey) throw new Error('BRIGHTDATA_API_KEY is required');
  if (!config.zone) throw new Error('BRIGHTDATA_ZONE is required');
  const endpoint = config.endpoint ?? process.env.BRIGHTDATA_ENDPOINT ?? 'https://api.brightdata.com/request';
  const timeoutMs = config.timeoutMs ?? Number(process.env.BRIGHTDATA_TIMEOUT_MS ?? 120_000);
  const maxRetries = Math.max(1, config.maxRetries ?? Number(process.env.BRIGHTDATA_MAX_RETRIES ?? 3));
  let attempt = 0;
  while (true) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Bright Data request timed out', 'TimeoutError')), timeoutMs);
    try {
      const response = await fetcher(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ zone: config.zone, url, format: 'raw' }), signal: controller.signal });
      if (!response.ok) {
        const error = new BrightDataHttpError(response.status);
        if (!error.retryable || attempt >= maxRetries) throw error;
        await delay(attempt === 1 ? 5_000 : 10_000);
        continue;
      }
      const body = await response.text();
      if (/adaptive rate limit|rate limit has been applied|please retry/i.test(body)) {
        if (attempt >= maxRetries) throw new Error('Bright Data rate limit response');
        await delay(attempt === 1 ? 5_000 : 10_000);
        continue;
      }
      return body;
    } catch (error) {
      const retryable = !(error instanceof BrightDataHttpError) || error.retryable;
      if (!retryable || attempt >= maxRetries) throw error;
      await delay(attempt === 1 ? 5_000 : 10_000);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function fetchBrightDataProduct(itemId: string, url: string, config: BrightDataConfig, fetcher?: typeof fetch, delay?: (milliseconds: number) => Promise<void>): Promise<BrightDataProduct> {
  const html = await fetchBrightDataHtml(url, config, fetcher, delay);
  return parseBrightDataProduct(itemId, html);
}

export const createBrightDataClient = (config: BrightDataConfig, fetcher?: typeof fetch) => ({
  fetch: (url: string, delay?: (milliseconds: number) => Promise<void>) => fetchBrightDataHtml(url, config, fetcher, delay),
  fetchProduct: (itemId: string, url: string, delay?: (milliseconds: number) => Promise<void>) => fetchBrightDataProduct(itemId, url, config, fetcher, delay),
});
