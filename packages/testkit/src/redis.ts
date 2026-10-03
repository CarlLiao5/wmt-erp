import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export interface RedisTestClientOptions {
  url?: string;
  prefix?: string;
}

export function createRedisTestClient({
  url = process.env.REDIS_URL,
  prefix = `test:${randomUUID()}:`,
}: RedisTestClientOptions = {}): Redis {
  if (!url) throw new Error('REDIS_URL is required to create a Redis test client');

  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    keyPrefix: prefix,
  });
}
