import express from 'express';
import { expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { authRouter } from './auth.js';
import { membersRouter } from './members.js';

it('restricts password reset to admins and passes only their tenant and a password hash to storage', async () => {
  const passwordHash = await hashPassword('test-password');
  vi.stubEnv('MYSQL_URL', '');
  const reset = vi.fn(async (_tenant: string, id: string, _hash: string) => id === 'target');
  const app = express();
  app.use(express.json());
  app.use(authRouter(async (email) => ({
    id: email, tenantId: 'test-tenant', role: email === 'manager@test.invalid' ? 'admin' : 'member', passwordHash,
  })));
  app.use(membersRouter(undefined, reset));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const base = 'http://127.0.0.1:' + address.port;
    const headers = { 'Content-Type': 'application/json' };
    const login = async (email: string) => {
      const response = await fetch(base + '/auth/login', { method: 'POST', headers, body: JSON.stringify({ email, password: 'test-password' }) });
      return (await response.json()).data.token as string;
    };
    const change = (token: string, id: string, password: string) => fetch(base + '/members/' + id + '/password', {
      method: 'PATCH', headers: { ...headers, Authorization: 'Bearer ' + token }, body: JSON.stringify({ password, tenantId: 'other-tenant' }),
    });
    expect((await change(await login('staff@test.invalid'), 'target', 'new-password')).status).toBe(403);
    expect(reset).not.toHaveBeenCalled();
    const admin = await login('manager@test.invalid');
    expect((await change(admin, 'target', 'short')).status).toBe(400);
    expect(reset).not.toHaveBeenCalled();
    expect((await change(admin, 'foreign', 'new-password')).status).toBe(404);
    expect((await change(admin, 'target', 'new-password')).status).toBe(200);
    const [tenant, id, hash] = reset.mock.calls.at(-1)!;
    expect([tenant, id]).toEqual(['test-tenant', 'target']);
    expect(hash).not.toBe('new-password');
    expect(await verifyPassword(hash, 'new-password')).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  }
});

it('allows only admins to set tenant-scoped normalized usernames', async () => {
  vi.stubEnv('MYSQL_URL', '');
  const passwordHash = await hashPassword('test-password');
  const update = vi.fn(async (_tenant: string, id: string, _username: string | null) => id === 'target');
  const app = express(); app.use(express.json());
  app.use(authRouter(async (id) => ({ id, tenantId: 'test-tenant', role: id === 'manager@test.invalid' ? 'admin' : 'member', passwordHash })));
  app.use(membersRouter(undefined, undefined, update));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
  const headers = { 'Content-Type': 'application/json' };
  const login = async (email: string) => (await (await fetch(base + '/auth/login', { method:'POST', headers, body:JSON.stringify({email,password:'test-password'}) })).json()).data.token;
  const change = (token: string, id: string, username: unknown) => fetch(base+'/members/'+id+'/username', {method:'PATCH',headers:{...headers,Authorization:'Bearer '+token},body:JSON.stringify({username,tenantId:'other'})});
  try {
    expect((await change(await login('staff@test.invalid'),'target','lqh')).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    const token = await login('manager@test.invalid');
    for (const name of ['bad@email', '中文', 'a'.repeat(65), 123]) expect((await change(token,'target',name)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect((await change(token,'foreign','lqh')).status).toBe(404);
    expect((await change(token,'target',' LQH ')).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith('test-tenant','target','lqh');
    expect((await change(token,'target','')).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith('test-tenant','target',null);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); }
});
