import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifests = [
  'package.json',
  'apps/api/package.json',
  'apps/worker/package.json',
  'apps/web/package.json',
  'packages/config/package.json',
  'packages/db/package.json',
  'packages/domain/package.json',
  'packages/walmart-client/package.json',
  'packages/testkit/package.json',
];

for (const relativePath of manifests) {
  const manifest = JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  assert.equal(typeof manifest.name, 'string', `${relativePath} must have a package name`);
}

const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
for (const command of [
  'dev',
  'dev:api',
  'dev:worker',
  'dev:web',
  'db:migrate',
  'test',
  'test:readonly-contract',
  'lint',
  'typecheck',
]) {
  assert.equal(typeof rootManifest.scripts?.[command], 'string', `root script ${command} must exist`);
}

console.log(`Workspace smoke check passed (${manifests.length} manifests, 9 root scripts).`);
