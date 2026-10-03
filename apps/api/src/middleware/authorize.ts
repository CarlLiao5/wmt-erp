import type { NextFunction, Request, Response } from 'express';
import { assertPermission, type Permission, type Role } from '@walmart-erp/domain';
export function authorize(permission: Permission) { return (req: Request & { user?: { role: Role } }, res: Response, next: NextFunction) => { try { assertPermission(req.user?.role ?? 'member', permission); next(); } catch { res.status(403).json({ error: 'Forbidden' }); } }; }
