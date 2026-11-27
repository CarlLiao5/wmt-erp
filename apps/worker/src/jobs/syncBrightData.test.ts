import { describe, expect, it, vi } from 'vitest';
import { brightDataIntervalMs, BrightDataHttpError, fetchBrightDataHtml, parseBrightDataProduct } from '@walmart-erp/walmart-client';
import { brightDataConfigFromEnvironment } from './syncBrightData.js';

describe('Bright Data adapter', () => {
  it('sends the Web Unlocker request body and parses product fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html><title>Widget</title><script type="application/ld+json">{"name":"Widget","price":"12.99","ratingValue":"4.5","reviewCount":"21","availableQuantity":"7"}</script></html>', { status: 200 }));
    const html = await fetchBrightDataHtml('https://www.walmart.com/ip/123', { apiKey: 'key', zone: 'zone' }, fetcher, async () => undefined);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ zone: 'zone', url: 'https://www.walmart.com/ip/123', format: 'raw' });
    expect(parseBrightDataProduct('123', html)).toMatchObject({ itemId: '123', productName: 'Widget', price: 12.99, rating: 4.5, reviewCount: 21, availableQuantity: 7 });
  });

  it('parses the inventory fields used by the original scraper', () => {
    expect(parseBrightDataProduct('123', '<script>{&quot;aggregateRating&quot;:{&quot;ratingValue&quot;:4.2,&quot;reviewCount&quot;:18},&quot;availableQuantity&quot;:213}</script>')).toMatchObject({ availableQuantity: 213, rating: 4.2, reviewCount: 18 });
  });

  it('leaves quantity null when the page has no inventory field', () => {
    expect(parseBrightDataProduct('123', '<title>Widget</title><meta name="description" content="A thing"><span>$4.00</span>')).toMatchObject({ productName: 'Widget', availableQuantity: null, price: 4 });
  });

  it('retries a 200 response containing Bright Data rate-limit text', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('A global adaptive rate limit has been applied. Please retry in a few seconds.', { status: 200 }))
      .mockResolvedValueOnce(new Response('<script>{"availableQuantity":9}</script>', { status: 200 }));
    await expect(fetchBrightDataHtml('https://example.test', { apiKey: 'key', zone: 'zone', maxRetries: 2 }, fetcher, async () => undefined)).resolves.toContain('availableQuantity');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx responses and retries 5xx responses', async () => {
    const fourHundred = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 400 }));
    await expect(fetchBrightDataHtml('https://example.test', { apiKey: 'key', zone: 'zone', maxRetries: 3 }, fourHundred, async () => undefined)).rejects.toBeInstanceOf(BrightDataHttpError);
    expect(fourHundred).toHaveBeenCalledTimes(1);
    const fiveHundred = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValue(new Response('ok', { status: 200 }));
    await expect(fetchBrightDataHtml('https://example.test', { apiKey: 'key', zone: 'zone', maxRetries: 3 }, fiveHundred, async () => undefined)).resolves.toBe('ok');
    expect(fiveHundred).toHaveBeenCalledTimes(2);
  });

  it('uses configured interval values and reads the environment interval', () => {
    vi.stubEnv('BRIGHTDATA_INTERVAL_MS', '1250');
    expect(brightDataConfigFromEnvironment().intervalMs).toBe(1250);
    expect(brightDataIntervalMs({ intervalMs: 750 })).toBe(750);
    expect(brightDataIntervalMs({ intervalMs: undefined })).toBe(3000);
    vi.unstubAllEnvs();
  });
});
