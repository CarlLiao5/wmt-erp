import { Router, type Request } from 'express';
import { and, createDb, eq, wecomBotConfigs } from '@walmart-erp/db';
import { encryptCredential } from '../security/credentials.js';
import { requestSession } from './auth.js';

export interface WecomBotConfigView { configured: boolean; documentUrl: string | null; tableId: string | null; updatedAt: Date | null }
export interface WecomConfigSource {
  get: (tenantId: string) => Promise<{ documentUrl: string; tableId: string; updatedAt: Date } | undefined>;
  save: (tenantId: string, value: { encryptedBotKey?: string; encryptedBotId?: string; encryptedBotSecret?: string; documentUrl: string; tableId: string }) => Promise<void>;
}

export function mysqlWecomConfigSource(): WecomConfigSource {
  return {
    async get(tenantId) {
      const { db, pool } = createDb();
      try {
        const [row] = await db.select({ documentUrl: wecomBotConfigs.documentUrl, tableId: wecomBotConfigs.tableId, updatedAt: wecomBotConfigs.updatedAt }).from(wecomBotConfigs).where(eq(wecomBotConfigs.tenantId, tenantId)).limit(1);
        return row;
      } finally {
        await pool.end();
      }
    },
    async save(tenantId, value) {
      const { db, pool } = createDb();
      try {
        await db.insert(wecomBotConfigs).values({ tenantId, ...value, updatedAt: new Date() }).onDuplicateKeyUpdate({ set: { ...value, updatedAt: new Date() } });
      } finally {
        await pool.end();
      }
    },
  };
}

export function wecomRouter(source: WecomConfigSource): Router {
  const router = Router();
  const session = async (req: Request) => requestSession(req);
  router.get('/wecom/head-freight/config', async (req, res, next) => {
    try { const current = await session(req); if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } }); const row = await source.get(current.tenantId); const data: WecomBotConfigView = row ? { configured: true, documentUrl: row.documentUrl, tableId: row.tableId, updatedAt: row.updatedAt } : { configured: false, documentUrl: null, tableId: null, updatedAt: null }; return res.json({ requestId: res.locals.requestId, data, error: null }); } catch (error) { return next(error); }
  });
  router.put('/wecom/head-freight/config', async (req, res, next) => {
    try { const current = await session(req); if (!current) return res.status(401).json({ requestId: res.locals.requestId, data: null, error: { message: 'Authentication required' } }); const body = req.body as { apiKey?: string; botId?: string; secret?: string; documentUrl?: string; tableId?: string }; if (!body.apiKey?.trim() || !body.documentUrl?.trim() || !body.tableId?.trim()) return res.status(400).json({ requestId: res.locals.requestId, data: null, error: { message: 'MCP API Key、智能文档 URL 和子表 ID 必填' } }); await source.save(current.tenantId, { encryptedBotKey: encryptCredential(body.apiKey), encryptedBotId: body.botId?.trim() ? encryptCredential(body.botId) : undefined, encryptedBotSecret: body.secret?.trim() ? encryptCredential(body.secret) : undefined, documentUrl: body.documentUrl, tableId: body.tableId }); return res.status(204).send(); } catch (error) { return next(error); }
  });
  return router;
}
