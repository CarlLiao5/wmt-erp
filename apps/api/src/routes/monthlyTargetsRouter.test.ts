import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { authRouter } from './auth.js';
import { monthlyTargetsRouter } from './monthlyTargetsRouter.js';
import { hashPassword } from '../auth/passwords.js';

const previousMysqlUrl = process.env.MYSQL_URL;
afterEach(() => { if (previousMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = previousMysqlUrl; });

describe('monthly target route authorization', () => {
  it('denies member initialization before touching target storage', async () => {
    delete process.env.MYSQL_URL;
    const app = express(); app.use(express.json());
    const passwordHash = await hashPassword('member-pass');
    app.use(authRouter(async () => ({ id: 'member-1', tenantId: 't1', role: 'member', passwordHash })));
    app.use(monthlyTargetsRouter({ visibility: async () => ({ tenantId: 't1', role: 'member', storeIds: new Set(), skus: new Set() }), orders: async () => [], inventory: async () => [] }));
    const server = await new Promise<import('node:http').Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
      const base = `http://127.0.0.1:${address.port}`;
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 't1', email: 'member@example.com', password: 'member-pass' }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const response = await fetch(`${base}/targets/initialize`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ month: '2026-11' }) });
      expect(response.status).toBe(403);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
