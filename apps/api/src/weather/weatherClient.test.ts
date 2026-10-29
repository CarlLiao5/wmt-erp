import { describe, expect, it, vi } from 'vitest';
import { fetchStateWeather, fetchStateClimate, parseClimateProbabilities, type StateWeatherSnapshot } from './weatherClient.js';
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
    expect(request).toHaveBeenCalledTimes(6);
    expect(request.mock.calls[0][1].headers['User-Agent']).toContain('wmterp');
    expect(sleep).toHaveBeenCalledWith(expect.any(Number));
  });

  it('preserves CPC above/near/below probabilities without inventing values', () => {
    expect(parseClimateProbabilities({ temperature: { aboveNormal: 40, nearNormal: 35, belowNormal: 25 }, precipitation: { aboveNormal: '20%', nearNormal: 50, belowNormal: 30 } })).toEqual({
      temperature: { aboveNormal: 40, nearNormal: 35, belowNormal: 25 },
      precipitation: { aboveNormal: 20, nearNormal: 50, belowNormal: 30 },
    });
  });

  it('rejects CPC HTML or JSON without probability bands as unavailable', async () => {
    expect(() => parseClimateProbabilities('<html>forecast</html>')).toThrow(/unavailable/);
    const request = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), json: async () => ({ html: '<table />' }) });
    await expect(fetchStateClimate(US_STATES_48[0], '6-10-day', { request, cache: { get: async () => undefined, set: vi.fn() } })).rejects.toThrow(/unavailable/);
  });
});
