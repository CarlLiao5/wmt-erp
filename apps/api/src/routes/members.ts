import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { createDb, eq, and, sessions, users } from '@walmart-erp/db';
import { hashPassword } from '../auth/passwords.js';
import { requestSession } from './auth.js';

export interface Member { id: string; email: string; role: 'admin' | 'member'; displayName: string | null; username?: string | null; }
export type MemberList = (tenantId: string) => Promise<Member[]>;

export function visibleMemberItems<T extends { storeId: string; sku: string }>(items: T[], member: { role: Member['role']; storeIds: Set<string>; skus: Set<string> }): T[] {
  return member.role === 'admin' ? items : items.filter((item) => member.storeIds.has(item.storeId) || member.skus.has(item.sku));
}

export function mysqlMembersSource(): MemberList {
  return async (tenantId) => {
    const { db, pool } = createDb();
    try {
      return await db.select({ id: users.id, email: users.email, username: users.username, role: users.role, displayName: users.displayName })
        .from(users).where(eq(users.tenantId, tenantId)) as Member[];
    } finally { await pool.end(); }
  };
}

type PasswordReset = (tenantId: string, userId: string, hash: string) => Promise<boolean>;

const resetMemberPassword: PasswordReset = async (tenantId, userId, passwordHash) => {
  const { db } = createDb();
  return db.transaction(async (tx) => {
    const scope = and(eq(users.tenantId, tenantId), eq(users.id, userId));
    const [result] = await tx.update(users).set({ passwordHash }).where(scope);
    if (!result.affectedRows) return false;
    await tx.delete(sessions).where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId)));
    return true;
  });
};

type UsernameUpdate = (tenantId: string, userId: string, username: string | null) => Promise<boolean>;
function normalizedUsername(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,64}$/.test(value.trim())) {
    throw new Error('用户名须为 1–64 位字母、数字或下划线');
  }
  return value.trim().toLowerCase();
}
function duplicateUsername(error: unknown): boolean {
  const e = error as { code?: string; cause?: unknown };
  return e?.code === 'ER_DUP_ENTRY' || !!e?.cause && duplicateUsername(e.cause);
}
const updateMemberUsername: UsernameUpdate = async (tenantId, userId, username) => {
  const { db, pool } = createDb();
  try {
    const scope = and(eq(users.tenantId, tenantId), eq(users.id, userId));
    const [row] = await db.select({ id: users.id }).from(users).where(scope).limit(1);
    if (!row) return false;
    await db.update(users).set({ username }).where(scope);
    return true;
  } finally { await pool.end(); }
};

export function membersRouter(list: MemberList = async () => [], reset: PasswordReset = resetMemberPassword, updateUsername: UsernameUpdate = updateMemberUsername): Router {
  const r = Router();
  r.get('/members', async (req, res, next) => {
    try {
      const session = await requestSession(req);
      if (!session?.tenantId) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authenticated visibility scope required' } });
      return res.json({ requestId: res.locals.requestId, data: await list(session.tenantId), error: null });
    } catch (e) { return next(e); }
  });

  r.post('/members', async (req, res, next) => {
    try {
      const session = await requestSession(req);
      if (!session?.tenantId || session.role !== 'admin') return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: '只有管理员可以添加成员' } });
      const body = req.body as { email?: string; password?: string; role?: 'admin' | 'member'; displayName?: string; username?: string };
      let username: string | null;
      try { username = normalizedUsername(body.username); }
      catch (error) { return res.status(400).json({ data: null, error: { message: (error as Error).message } }); }
      const email = String(body.email ?? '').trim().toLowerCase();
      const displayName = String(body.displayName ?? '').trim() || null;
      const password = String(body.password ?? '');
      const role = body.role === 'admin' ? 'admin' : 'member';
      if (!email || !email.includes('@') || password.length < 8) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: '邮箱有效且密码至少 8 位' } });

      const { db, pool } = createDb();
      try {
        const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, session.tenantId), eq(users.email, email))).limit(1);
        if (existing) return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: '成员邮箱已存在' } });
        if (displayName) {
          const [sameName] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, session.tenantId), eq(users.displayName, displayName))).limit(1);
          if (sameName) return res.status(409).json({ requestId: res.locals.requestId, data: null, error: { message: '成员显示姓名已存在' } });
        }
        const member = { id: randomUUID(), tenantId: session.tenantId, email, username, displayName, passwordHash: await hashPassword(password), role, createdAt: new Date() };
        await db.insert(users).values(member);
        return res.status(201).json({ requestId: res.locals.requestId, data: { id: member.id, email: member.email, username: member.username, role: member.role, displayName: member.displayName }, error: null });
      } finally { await pool.end(); }
    } catch (e) {
      if (duplicateUsername(e)) return res.status(409).json({ data: null, error: { message: '用户名、邮箱或显示姓名已存在' } });
      return next(e);
    }
  });
  r.patch('/members/:id/username', async (req, res, next) => {
    const fail = (status: number, message: string) => res.status(status).json({ data: null, error: { message } });
    try {
      const session = await requestSession(req, false);
      if (!session) return fail(401, '请先登录');
      if (session.role !== 'admin') return fail(403, '只有管理员可以设置登录用户名');
      if (!req.is('application/json')) return fail(415, '请提交 JSON 请求');
      if (!Object.hasOwn(req.body ?? {}, 'username')) return fail(400, '请提交用户名');
      let username: string | null;
      try { username = normalizedUsername(req.body.username); }
      catch (error) { return fail(400, (error as Error).message); }
      if (req.params.id === 'admin' || req.params.id.length > 36) return fail(404, '未找到成员');
      if (!await updateUsername(session.tenantId, req.params.id, username)) return fail(404, '未找到成员');
      return res.json({ data: { username }, error: null });
    } catch (error) {
      if (duplicateUsername(error)) return fail(409, '该登录用户名已被使用');
      return next(error);
    }
  });
  r.patch('/members/:id/password', async (req, res, next) => {
    const fail = (status: number, message: string) => res.status(status).json({
      requestId: res.locals.requestId, data: null, error: { message },
    });
    try {
      // Mutations accept cookies or explicit bearer credentials, never a query token.
      const session = await requestSession(req, false);
      if (!session?.tenantId) return fail(401, '请先登录');
      if (session.role !== 'admin') return fail(403, '只有管理员可以重设密码');
      if (!req.is('application/json')) return fail(415, '请提交 JSON 请求');
      const password = req.body?.password;
      if (typeof password !== 'string' || password.trim().length === 0 || password.length < 8 || password.length > 128) {
        return fail(400, '密码须为 8–128 位，且不能全为空白');
      }
      if (req.params.id === 'admin' || req.params.id.length > 36) return fail(404, '未找到成员');
      if (!await reset(session.tenantId, req.params.id, await hashPassword(password))) return fail(404, '未找到成员');
      return res.json({ requestId: res.locals.requestId, data: { updated: true }, error: null });
    } catch (error) { return next(error); }
  });
  return r;
}
