import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, eq, lingxingConfigs } from '../../../../packages/db/index.js';

export type LingxingSyncWindow = { tenantId: string; from: string; to: string; batchId?: string };

function decryptCredential(value: string): string {
  const keyValue = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyValue) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be configured');
  const key = /^[a-f0-9]{64}$/i.test(keyValue) ? Buffer.from(keyValue, 'hex') : Buffer.from(keyValue, 'utf8');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes or 64 hexadecimal characters');
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted credential format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

async function loadLingxingConfig(tenantId: string): Promise<{ mcpKey: string; advertiserIds: string }> {
  const { db, pool } = createDb();
  try {
    const [row] = await db.select({ encryptedMcpKey: lingxingConfigs.encryptedMcpKey, advertiserIds: lingxingConfigs.advertiserIds }).from(lingxingConfigs).where(eq(lingxingConfigs.tenantId, tenantId)).limit(1);
    if (!row) throw new Error('领星配置未设置，请先在店铺管理中保存领星 MCP API Key');
    return { mcpKey: decryptCredential(row.encryptedMcpKey), advertiserIds: row.advertiserIds };
  } finally { await pool.end(); }
}

export async function runLingxingAdvertising(window: LingxingSyncWindow): Promise<{ resource: 'lingxing-advertising'; written: number; output: string }> {
  const config = await loadLingxingConfig(window.tenantId);
  const script = process.env.LINGXING_ETL_SCRIPT ?? fileURLToPath(new URL('../../../../ops/lingxing-etl/lingxing_sp_item_daily.py', import.meta.url));
  const bundledPython = fileURLToPath(new URL('../../../../ops/lingxing-etl/venv/bin/python', import.meta.url));
  const python = process.env.LINGXING_PYTHON ?? (existsSync(bundledPython) ? bundledPython : 'python3');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, '--days', process.env.LINGXING_SYNC_DAYS ?? '3', '--mcp-key', config.mcpKey, '--advertiser-ids', config.advertiserIds], { env: { ...process.env, ETL_ENV_ONLY: process.env.ETL_ENV_ONLY ?? '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => {
      const match = output.match(/DONE total=(\d+)/);
      if (code !== 0) return reject(new Error(`Lingxing ETL failed with exit code ${code ?? 'unknown'}${output.trim() ? `: ${output.trim().slice(-500)}` : ''}`));
      resolve({ resource: 'lingxing-advertising', written: Number(match?.[1] ?? 0), output: output.slice(-2000) });
    });
  });
}
