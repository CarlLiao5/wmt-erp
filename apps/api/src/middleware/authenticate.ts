import type { NextFunction, Request, Response } from 'express';
import { parseSessionId, type SessionRecord } from '../auth/sessions.js';
export type SessionLookup = (id: string) => Promise<SessionRecord | undefined>;
export function requireSession(lookup: SessionLookup) { return async (req: Request & { session?: SessionRecord }, res: Response, next: NextFunction) => { const id = parseSessionId(req.headers.cookie); const session = id ? await lookup(id) : undefined; if (!session || session.expiresAt <= new Date()) return res.status(401).json({ error: 'Unauthorized' }); req.session = session; next(); }; }
