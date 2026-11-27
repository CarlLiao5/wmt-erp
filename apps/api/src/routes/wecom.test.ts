import express from 'express';
import { describe, expect, it, beforeEach } from 'vitest';
import { wecomRouter, type WecomConfigSource } from './wecom.js';

describe('WeCom head freight configuration', () => {
  beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef'; });
  it('masks the bot key and scopes config to the authenticated tenant', async () => {
    let saved: { tenantId: string; encryptedBotId: string } | undefined;
    const source: WecomConfigSource = { get: async (tenantId) => tenantId === 't1' ? { documentUrl: 'https://doc', tableId: 'tbl', updatedAt: new Date('2026-10-15') } : undefined, save: async (tenantId, value) => { saved = { tenantId, encryptedBotId: value.encryptedBotId ?? '' }; } };
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); }); app.use(wecomRouter(source));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start'); const base = `http://127.0.0.1:${address.port}`;
    try { const unauth = await fetch(`${base}/wecom/head-freight/config`); expect(unauth.status).toBe(401); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    expect(saved).toBeUndefined();
  });
});
