import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestFixtures } from './fixtures.js';
import { createMysqlTestPool } from './mysql.js';
import { createRedisTestClient } from './redis.js';

describe('testkit fixtures', () => {
  it('returns stable tenant and user identities for a named seed', () => {
    const first = createTestFixtures('orders-suite');
    const second = createTestFixtures('orders-suite');

    expect(first.tenant.id).toBe(second.tenant.id);
    expect(first.admin.id).toBe(second.admin.id);
    expect(first.member.id).toBe(second.member.id);
    expect(first.member.tenantId).toBe(first.tenant.id);
    expect(first.admin.role).toBe('admin');
    expect(first.member.role).toBe('member');
  });

  it('creates an Express app that can be exercised through HTTP', async () => {
    const app = createTestApp((router) => {
      router.get('/health', (_req, res) => res.json({ status: 'ok' }));
    });

    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  it('fails fast when database fixture connection URLs are missing', () => {
    expect(() => createMysqlTestPool('')).toThrow('MYSQL_URL is required');
    expect(() => createRedisTestClient({ url: '' })).toThrow('REDIS_URL is required');
  });
});
