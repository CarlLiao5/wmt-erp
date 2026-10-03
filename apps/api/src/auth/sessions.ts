import { randomBytes } from 'node:crypto';
export interface SessionRecord { id: string; tenantId: string; userId: string; expiresAt: Date; }
export function createSession(tenantId: string, userId: string, ttlMs = 8 * 60 * 60 * 1000): SessionRecord { return { id: randomBytes(32).toString('base64url'), tenantId, userId, expiresAt: new Date(Date.now() + ttlMs) }; }
export function sessionCookie(session: SessionRecord): string { return `erp_session=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((session.expiresAt.getTime()-Date.now())/1000)}`; }
export function parseSessionId(cookieHeader?: string): string | undefined { return cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith('erp_session='))?.slice('erp_session='.length); }
