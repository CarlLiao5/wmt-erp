import { Router, type Request } from 'express';
import { createDb, eq, lingxingConfigs } from '@walmart-erp/db';
import { encryptCredential } from '../security/credentials.js';
import { requestSession } from './auth.js';

export interface LingxingConfigView { configured: boolean; advertiserIds: number[]; updatedAt: Date | null }
export interface LingxingConfigSource {
  get: (tenantId: string) => Promise<{ advertiserIds: string; updatedAt: Date } | undefined>;
  save: (tenantId: string, value: { encryptedMcpKey: string; advertiserIds: string }) => Promise<void>;
}

export function mysqlLingxingConfigSource(): LingxingConfigSource {
  return {
    async get(tenantId) {
      const { db, pool } = createDb();
      try {
        const [row] = await db.select({ advertiserIds: lingxingConfigs.advertiserIds, updatedAt: lingxingConfigs.updatedAt }).from(lingxingConfigs).where(eq(lingxingConfigs.tenantId, tenantId)).limit(1);
        return row;
      } finally { await pool.end(); }
    },
    async save(tenantId, value) {
      const { db, pool } = createDb();
      try {
        await db.insert(lingxingConfigs).values({ tenantId, ...value, updatedAt: new Date() }).onDuplicateKeyUpdate({ set: { ...value, updatedAt: new Date() } });
      } finally { await pool.end(); }
    },
  };
}

function parseAdvertiserIds(value: string): number[] {
  return value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
}

export function lingxingRouter(source: LingxingConfigSource): Router {
  const router = Router();
  const session = async (req: Request) => requestSession(req);
  router.get('/lingxing/config', async (req, res, next) => {
    try {
      const current = await session(req);
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      const row = await source.get(current.tenantId);
      const ids = row ? parseAdvertiserIds(row.advertiserIds) : [];
      return res.json({ requestId: res.locals.requestId, data: { configured: Boolean(row), advertiserIds: ids, updatedAt: row?.updatedAt ?? null } satisfies LingxingConfigView, error: null });
    } catch (error) { return next(error); }
  });
  router.put('/lingxing/config', async (req, res, next) => {
    try {
      const current = await session(req);
      if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } });
      if (current.role !== 'admin') return res.status(403).json({ requestId: res.locals.requestId, data: null, error: { message: '需要管理员权限' } });
      const body = req.body as { apiKey?: string; advertiserIds?: string | number[] };
      const key = body.apiKey?.trim();
      const ids = Array.isArray(body.advertiserIds) ? body.advertiserIds.join(',') : String(body.advertiserIds ?? '');
      if (!key || !parseAdvertiserIds(ids).length) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: '领星 MCP API Key 和广告账户 ID 必填' } });
      await source.save(current.tenantId, { encryptedMcpKey: encryptCredential(key), advertiserIds: parseAdvertiserIds(ids).join(',') });
      return res.status(204).send();
    } catch (error) { return next(error); }
  });
  return router;
}
