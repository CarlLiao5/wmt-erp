import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = path.join(root, 'packages/walmart-client/src');
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(fullPath);
  }
}

await collect(sourceRoot);
const bypasses = [];
for (const file of files) {
  if (path.basename(file) === 'request.ts') continue;
  const source = await readFile(file, 'utf8');
  if (/\b(?:fetch|fetcher)\s*\(/.test(source)) bypasses.push(path.relative(root, file));
}

assert.deepEqual(bypasses, [], `Walmart requests must use the guarded request helper: ${bypasses.join(', ')}`);
console.log(`Walmart read-only source contract passed (${files.length} source files scanned).`);
