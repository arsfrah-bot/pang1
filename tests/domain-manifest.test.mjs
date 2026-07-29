import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Domain = require('../app/src/main/assets/bazdidyar_pwa/engine/domain-loader.js');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const domainRoot = join(root, 'domain');

async function runtimeJsonFiles(dir = domainRoot) {
  const output = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    const path = relative(domainRoot, full).replace(/\\/g, '/');
    if (entry.isDirectory() && path !== 'schemas') output.push(...await runtimeJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json') && path !== 'manifest.json') output.push(path);
  }
  return output;
}

test('domain manifest lists every runtime JSON asset exactly once', async () => {
  const manifestSource = JSON.parse(await readFile(join(domainRoot, 'manifest.json'), 'utf8'));
  const manifest = Domain.validateManifest(manifestSource);
  const listed = manifest.files.map(item => item.path).sort();
  const actual = (await runtimeJsonFiles()).sort();
  assert.deepEqual(listed, actual);
  assert.equal(listed.length, 32);
});

test('every manifest-listed asset can be registered with identity and version', async () => {
  const manifest = Domain.validateManifest(JSON.parse(await readFile(join(domainRoot, 'manifest.json'), 'utf8')));
  const registry = new Domain.CatalogRegistry();
  for (const entry of manifest.files) {
    const asset = JSON.parse(await readFile(join(domainRoot, entry.path), 'utf8'));
    registry.register(asset, entry.path);
  }
  assert.equal(registry.list().length, manifest.files.length);
});
