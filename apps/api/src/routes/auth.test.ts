import express from 'express';
import { afterEach, expect, it } from 'vitest';
import { authRouter } from './auth.js';

const previousMysqlUrl = process.env.MYSQL_URL;
const previousAdminEmail = process.env.ERP_ADMIN_EMAIL;
const previousAdminPassword = process.env.ERP_ADMIN_PASSWORD;
afterEach(() => {
  if (previousMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = previousMysqlUrl;
  if (previousAdminEmail === undefined) delete process.env.ERP_ADMIN_EMAIL; else process.env.ERP_ADMIN_EMAIL = previousAdminEmail;
  if (previousAdminPassword === undefined) delete process.env.ERP_ADMIN_PASSWORD; else process.env.ERP_ADMIN_PASSWORD = previousAdminPassword;
});

it('invalidates the current bearer session and clears its cookie on logout', async () => {
  delete process.env.MYSQL_URL;
  process.env.ERP_ADMIN_EMAIL = 'logout@example.com';
  process.env.ERP_ADMIN_PASSWORD = 'logout-password';
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.requestId = 'test-request'; next(); });
  app.use(authRouter());
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'logout@example.com', password: 'logout-password' }),
    });
    const loginBody = await login.json() as { data: { token: string } };

    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginBody.data.token}` },
    });

    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    const me = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${loginBody.data.token}` },
    });
    expect(me.status).toBe(401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

it('accepts a normalized username without changing legacy email login', async () => {
  delete process.env.MYSQL_URL;
  const { hashPassword } = await import('../auth/passwords.js');
  const hash = await hashPassword('member-password');
  const seen: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(authRouter(async (identifier, tenantId) => {
    seen.push(identifier);
    return ['lqh', 'person@example.com'].includes(identifier)
      ? { id: 'member', tenantId, role: 'member', passwordHash: hash } : undefined;
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    for (const account of [{ username: ' LQH ' }, { email: ' Person@Example.com ' }]) {
      const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...account, password: 'member-password' }),
      });
      expect(response.status).toBe(200);
    }
    expect(seen).toEqual(['lqh', 'person@example.com']);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
