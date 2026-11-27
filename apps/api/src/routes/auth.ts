import { Router, type Request } from 'express';
import { createSession, sessionCookie } from '../auth/sessions.js';
import { parseSessionId } from '../auth/sessions.js';
import { and, createDb, eq, users, sessions } from '@walmart-erp/db';
import { verifyPassword } from '../auth/passwords.js';
const memorySessions = new Map<string, { tenantId: string; userId: string; role: 'admin' | 'member'; expiresAt: Date }>();
export async function authenticatedSession(cookie?: string): Promise<{ tenantId: string; userId: string; role: 'admin' | 'member'; expiresAt: Date } | undefined> {
  const id = parseSessionId(cookie);
  if (!id) return undefined;
  if (!process.env.MYSQL_URL) {
    const memory = memorySessions.get(id);
    return memory && memory.expiresAt > new Date() ? memory : undefined;
  }
  const { db } = createDb();
  // Check persistent sessions on every request so password resets take effect across API processes.
  const [row] = await db.select({
    tenantId: sessions.tenantId, userId: sessions.userId, expiresAt: sessions.expiresAt, role: users.role,
  }).from(sessions).leftJoin(users, and(eq(users.id, sessions.userId), eq(users.tenantId, sessions.tenantId)))
    .where(eq(sessions.id, id)).limit(1);
  if (!row || row.expiresAt <= new Date()) return undefined;
  const role = row.userId === 'admin' ? 'admin' : row.role;
  if (role !== 'admin' && role !== 'member') return undefined;
  return { tenantId: row.tenantId, userId: row.userId, expiresAt: row.expiresAt, role };
}
/** Resolve the same session source used by the browser request layer. */
export function requestSession(req: Request, allowQueryToken = true) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const query = allowQueryToken && typeof req.query.session === 'string' ? req.query.session : undefined;
  const token = bearer ?? query;
  return authenticatedSession(token ? `erp_session=${token}` : req.headers.cookie);
}
export interface AuthUser { id: string; tenantId: string; role: 'admin' | 'member'; passwordHash: string; }
export type UserFinder = (email: string, tenantId: string) => Promise<AuthUser | undefined>;
export function mysqlUserFinder(): UserFinder {
  return async (identifier, tenantId) => {
    const { db, pool } = createDb();
    try {
      const column = identifier.includes('@') ? users.email : users.username;
      const [row] = await db.select().from(users).where(and(eq(column, identifier), eq(users.tenantId, tenantId))).limit(1);
      return row && (row.role === 'admin' || row.role === 'member')
        ? { id: row.id, tenantId: row.tenantId, role: row.role, passwordHash: row.passwordHash } : undefined;
    } finally { await pool.end(); }
  };
}
export function authRouter(findUser?: UserFinder): Router {
  const r = Router();
  r.get('/auth/login', (_req, res) => res.status(405).json({ error: { message: '请从前端登录页面提交 POST 请求' } }));
  r.post('/auth/login', async (req, res, next) => { try {
    const { email, username, password, tenantId } = req.body as { email?: string; username?: string; password?: string; tenantId?: string };
    const rawIdentifier = username ?? email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim().toLowerCase() : '';
    let user: Omit<AuthUser, 'passwordHash'> | undefined;
    if (identifier === (process.env.ERP_ADMIN_EMAIL ?? 'admin@example.com').trim().toLowerCase() && password === (process.env.ERP_ADMIN_PASSWORD ?? 'admin123')) user = { id: 'admin', tenantId: process.env.DEFAULT_TENANT_ID ?? 'default', role: 'admin' };
    else if (identifier && typeof password === 'string' && password && findUser) { const found = await findUser(identifier, tenantId ?? process.env.DEFAULT_TENANT_ID ?? 'default'); if (found && await verifyPassword(found.passwordHash, password)) user = found; }
    if (!user) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '用户名、邮箱或密码错误' } });
    const session = createSession(user.tenantId, user.id);
    if (!process.env.MYSQL_URL) memorySessions.set(session.id, { tenantId: user.tenantId, userId: user.id, role: user.role, expiresAt: session.expiresAt });
    if (process.env.MYSQL_URL) {
      const { db, pool } = createDb();
      try { await db.insert(sessions).values({ id: session.id, tenantId: user.tenantId, userId: user.id, expiresAt: session.expiresAt, createdAt: new Date() }); } finally { await pool.end(); }
    }
    res.setHeader('Set-Cookie', sessionCookie(session));
    return res.json({ requestId: res.locals.requestId, data: { userId: user.id, role: user.role, token: session.id }, error: null });
  } catch (error) { return next(error); } });
  r.get('/auth/me', async (req, res) => { const bearerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined; const queryToken = typeof req.query.session === 'string' ? req.query.session : undefined; const preferred = bearerToken ?? queryToken ?? parseSessionId(req.headers.cookie); const session = await requestSession(req); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } }); res.setHeader('Set-Cookie', sessionCookie({ id: preferred!, tenantId: session.tenantId, userId: session.userId, expiresAt: session.expiresAt })); return res.json({ requestId: res.locals.requestId, data: { userId: session.userId, role: session.role }, error: null }); });
  r.post('/auth/logout', async (req, res, next) => {
    const bearerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const queryToken = typeof req.query.session === 'string' ? req.query.session : undefined;
    const sessionId = bearerToken ?? queryToken ?? parseSessionId(req.headers.cookie);
    if (sessionId) {
      memorySessions.delete(sessionId);
      if (process.env.MYSQL_URL) {
        try {
          const { db, pool } = createDb();
          try { await db.delete(sessions).where(eq(sessions.id, sessionId)); } finally { await pool.end(); }
        } catch (error) { return next(error); }
      }
    }
    res.setHeader('Set-Cookie', 'erp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.sendStatus(204);
  });
  return r;
}
