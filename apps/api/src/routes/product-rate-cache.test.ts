import { expect, it } from 'vitest';
import { createTtlCache } from './product-rate-cache.js';

it('reuses a product-rate aggregate until its TTL expires', async () => {
  let now = 100;
  let loads = 0;
  const cache = createTtlCache<string, number>({ ttlMs: 50, maxEntries: 2, now: () => now });
  const load = async () => ++loads;

  await expect(cache.getOrLoad('tenant-a:scope-a', load)).resolves.toBe(1);
  await expect(cache.getOrLoad('tenant-a:scope-a', load)).resolves.toBe(1);
  now = 151;
  await expect(cache.getOrLoad('tenant-a:scope-a', load)).resolves.toBe(2);

  expect(loads).toBe(2);
});

it('keeps cache entries isolated by key and bounds retained entries', async () => {
  const cache = createTtlCache<string, string>({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
  await cache.getOrLoad('tenant-a:member-scope', async () => 'member data');
  await expect(cache.getOrLoad('tenant-a:admin-scope', async () => 'admin data')).resolves.toBe('admin data');
  await cache.getOrLoad('tenant-b:member-scope', async () => 'other tenant');
  await expect(cache.getOrLoad('tenant-a:member-scope', async () => 'reloaded')).resolves.toBe('reloaded');
});

it('coalesces concurrent loads for the same key', async () => {
  const cache = createTtlCache<string, number>({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
  let loads = 0;
  const load = async () => { loads += 1; await Promise.resolve(); return loads; };

  await expect(Promise.all([cache.getOrLoad('same', load), cache.getOrLoad('same', load)])).resolves.toEqual([1, 1]);
  expect(loads).toBe(1);
});
