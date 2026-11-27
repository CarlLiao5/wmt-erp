export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

export function createTtlCache<K, V>({ ttlMs, maxEntries, now = Date.now }: TtlCacheOptions) {
  const entries = new Map<K, { expiresAt: number; value: Promise<V> }>();

  return {
    async getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
      const current = entries.get(key);
      if (current && current.expiresAt > now()) {
        entries.delete(key);
        entries.set(key, current);
        return current.value;
      }
      if (current) entries.delete(key);

      const entry = { expiresAt: Number.POSITIVE_INFINITY, value: Promise.resolve().then(load) };
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as K);

      try {
        const value = await entry.value;
        entry.expiresAt = now() + ttlMs;
        return value;
      } catch (error) {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }
    },
  };
}
