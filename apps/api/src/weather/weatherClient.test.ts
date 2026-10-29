import { describe, expect, it, vi } from 'vitest';
import { fetchStateWeather, type StateWeatherSnapshot } from './weatherClient.js';
import { US_STATES_48 } from '@walmart-erp/domain';

describe('weather client', () => {
  it('returns a cached snapshot without issuing a request', async () => {
    const cached: StateWeatherSnapshot = { stateCode: 'CA', observedAt: new Date('2026-01-01'), current: { temperature: 20 }, forecast: [], alerts: [], raw: {} };
    const request = vi.fn();
    const result = await fetchStateWeather(US_STATES_48.find((s) => s.code === 'CA')!, { request, cache: { get: async () => cached, set: vi.fn() } });
    expect(result).toEqual(cached);
    expect(request).not.toHaveBeenCalled();
  });

  it('retries a 429 response with bounded backoff and sends a user agent', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 429, headers: new Headers({ 'retry-after': '0' }) }).mockResolvedValue({ status: 200, ok: true, headers: new Headers(), json: async () => ({ properties: {} }) });
    const sleep = vi.fn(async () => undefined);
    await fetchStateWeather(US_STATES_48[0], { request, cache: { get: async () => undefined, set: vi.fn() }, sleep, maxRetries: 1 });
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls[0][1].headers['User-Agent']).toContain('wmterp');
    expect(sleep).toHaveBeenCalledWith(expect.any(Number));
  });
});
