import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const express = createRequire(new URL('../apps/api/package.json', import.meta.url))('express') as typeof import('../apps/api/node_modules/express');
import { createDb } from '../packages/db/src/db.js';
import { authRouter, mysqlUserFinder } from '../apps/api/src/routes/auth.js';
import { membersRouter, mysqlMembersSource } from '../apps/api/src/routes/members.js';
import { hashPassword } from '../apps/api/src/auth/passwords.js';

if (new URL(process.env.MYSQL_URL!).hostname.toLowerCase() !== 'doke.synology.me') throw new Error('Use Doke only');
const { pool } = createDb();
const tenant = randomUUID(), otherTenant = randomUUID();
const admin = randomUUID(), member = randomUUID(), duplicate = randomUUID(), foreign = randomUUID();
const password = randomUUID();
const hash = await hashPassword(password);
const app = express(); app.use(express.json());
app.use(authRouter(mysqlUserFinder())); app.use(membersRouter(mysqlMembersSource()));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = process.env.USERNAME_VERIFY_API_BASE ?? ('http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port);
const json = { 'Content-Type': 'application/json' };
const login = async (identifier: string, tenantId = tenant) => fetch(base + '/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: identifier, password, tenantId }) });
try {
  for (const id of [tenant, otherTenant]) await pool.execute('INSERT INTO tenants (id,name,created_at) VALUES (?,?,NOW(3))', [id, 'username-regression']);
  for (const [id, tenantId, role] of [[admin,tenant,'admin'],[member,tenant,'member'],[duplicate,tenant,'member'],[foreign,otherTenant,'member']]) {
    await pool.execute('INSERT INTO users (id,tenant_id,email,password_hash,role,created_at) VALUES (?,?,?,?,?,NOW(3))', [id,tenantId,id+'@test.invalid',hash,role]);
  }
  const response = await login(admin+'@test.invalid'); assert.equal(response.status, 200);
  const token = (await response.json()).data.token;
  const set = (id: string, username: string) => fetch(base+'/members/'+id+'/username', {method:'PATCH',headers:{...json,Authorization:'Bearer '+token},body:JSON.stringify({username})});
  const create = (username: string) => fetch(base+'/members', {method:'POST',headers:{...json,Authorization:'Bearer '+token},body:JSON.stringify({email:randomUUID()+'@test.invalid',password,username})});
  assert.equal((await create(' CREATED ')).status, 201);
  assert.equal((await login('created')).status, 200);
  assert.equal((await create('Created')).status, 409);
  assert.equal((await create('invalid@email')).status, 400);
  assert.equal((await set(member,' LQH ')).status, 200);
  assert.equal((await login('LQH')).status, 200);
  assert.equal((await login(member+'@test.invalid')).status, 200);
  assert.equal((await set(duplicate,'lQh')).status, 409);
  assert.equal((await set(foreign,'foreign')).status, 404);
  assert.equal((await login('lqh',otherTenant)).status, 401);
  const list = await fetch(base+'/members', {headers:{Authorization:'Bearer '+token}});
  assert.equal((await list.json()).data.find((row: {id:string})=>row.id===member).username,'lqh');
  assert.equal((await set(member,'')).status, 200);
  assert.equal((await login('lqh')).status, 401);
  assert.equal((await login(member+'@test.invalid')).status, 200);
  console.log('PASS Doke: username/email login, normalization, duplicate rejection, tenant isolation, list and clear');
} finally {
  await pool.execute('DELETE FROM sessions WHERE tenant_id IN (?,?)',[tenant,otherTenant]);
  await pool.execute('DELETE FROM users WHERE tenant_id IN (?,?)',[tenant,otherTenant]);
  await pool.execute('DELETE FROM tenants WHERE id IN (?,?)',[tenant,otherTenant]);
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}
process.exit(0);
