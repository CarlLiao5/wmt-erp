import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type LingxingHeadFreightCostWindow = { tenantId: string; batchId: string };

export async function runLingxingHeadFreightCosts(window: LingxingHeadFreightCostWindow): Promise<{
  resource: 'lingxing-head-freight-costs';
  written: number;
  shipments: number;
  output: string;
}> {
  const script = process.env.LINGXING_HEAD_FREIGHT_COSTS_SCRIPT
    ?? fileURLToPath(new URL('../../../../scripts/lingxing-head-freight-po-lookup.py', import.meta.url));
  const bundledPython = fileURLToPath(new URL('../../../../ops/lingxing-etl/venv/bin/python', import.meta.url));
  const python = process.env.LINGXING_PYTHON ?? (existsSync(bundledPython) ? bundledPython : 'python3');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, '--tenant', window.tenantId, '--batch-id', window.batchId, '--write-to-db'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => {
      const result = output.match(/DONE shipments=(\d+) shipped_sku_rows=(\d+) errors=(\d+)/);
      if (code !== 0) return reject(new Error(`Lingxing head freight cost sync failed with exit code ${code ?? 'unknown'}${output.trim() ? `: ${output.trim().slice(-500)}` : ''}`));
      resolve({
        resource: 'lingxing-head-freight-costs',
        shipments: Number(result?.[1] ?? 0),
        written: Number(result?.[2] ?? 0),
        output: output.slice(-2000),
      });
    });
  });
}
