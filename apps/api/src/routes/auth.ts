import { Router } from 'express';
import { createSession, sessionCookie } from '../auth/sessions.js';
import { parseSessionId } from '../auth/sessions.js';
import { and, createDb, eq, users } from '@walmart-erp/db';
import { verifyPassword } from '../auth/passwords.js';
const sessions = new Map<string, { tenantId: string; userId: string; role: 'admin' | 'member'; expiresAt: Date }>();
export function authenticatedSession(cookie?: string) { const id = parseSessionId(cookie); const session = id ? sessions.get(id) : undefined; return session && session.expiresAt > new Date() ? session : undefined; }
export interface AuthUser { id: string; tenantId: string; role: 'admin' | 'member'; passwordHash: string; }
export type UserFinder = (email: string, tenantId: string) => Promise<AuthUser | undefined>;
export function mysqlUserFinder(): UserFinder { const { db } = createDb(); return async (email, tenantId) => { const [row] = await db.select().from(users).where(and(eq(users.email, email), eq(users.tenantId, tenantId))).limit(1); return row && (row.role === 'admin' || row.role === 'member') ? { id: row.id, tenantId: row.tenantId, role: row.role, passwordHash: row.passwordHash } : undefined; }; }
export function authRouter(findUser?: UserFinder): Router {
  const r = Router();
  r.get('/auth/login', (_req, res) => res.status(405).json({ error: { message: '请从前端登录页面提交 POST 请求' } }));
  r.post('/auth/login', async (req, res, next) => { try {
    const { email, password, tenantId } = req.body as { email?: string; password?: string; tenantId?: string };
    let user: Omit<AuthUser, 'passwordHash'> | undefined;
    if (email === (process.env.ERP_ADMIN_EMAIL ?? 'admin@example.com') && password === (process.env.ERP_ADMIN_PASSWORD ?? 'admin123')) user = { id: 'admin', tenantId: process.env.DEFAULT_TENANT_ID ?? 'default', role: 'admin' };
    else if (email && password && findUser) { const found = await findUser(email, tenantId ?? process.env.DEFAULT_TENANT_ID ?? 'default'); if (found && await verifyPassword(found.passwordHash, password)) user = found; }
    if (!user) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '邮箱或密码错误' } });
    const session = createSession(user.tenantId, user.id);
    sessions.set(session.id, { tenantId: user.tenantId, userId: user.id, role: user.role, expiresAt: session.expiresAt });
    res.setHeader('Set-Cookie', sessionCookie(session));
    return res.json({ requestId: res.locals.requestId, data: { userId: user.id, role: user.role }, error: null });
  } catch (error) { return next(error); } });
  r.get('/auth/me', (req, res) => { const session = authenticatedSession(req.headers.cookie); if (!session) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: '未登录' } }); return res.json({ requestId: res.locals.requestId, data: { userId: session.userId, role: session.role }, error: null }); });
  return r;
}
