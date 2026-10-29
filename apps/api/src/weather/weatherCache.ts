export interface WeatherCache { get<T = unknown>(key: string): Promise<T | undefined>; set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void>; }

export function createMemoryWeatherCache(now: () => number = Date.now): WeatherCache {
  const values = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get<T>(key: string) { const entry = values.get(key); if (!entry || entry.expiresAt <= now()) { values.delete(key); return undefined; } return entry.value as T; },
    async set<T>(key: string, value: T, ttlSeconds: number) { values.set(key, { value, expiresAt: now() + ttlSeconds * 1000 }); },
  };
}

export function createRedisWeatherCache(redis: { get(key: string): Promise<string | null>; set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown> }): WeatherCache {
  return { async get<T>(key: string) { const raw = await redis.get(key); return raw ? JSON.parse(raw) as T : undefined; }, async set<T>(key: string, value: T, ttl: number) { await redis.set(key, JSON.stringify(value), 'EX', ttl); } };
}
