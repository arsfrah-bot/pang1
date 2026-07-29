import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Domain = require('../app/src/main/assets/bazdidyar_pwa/engine/domain-loader.js');

test('manifest validation rejects traversal and duplicates', () => {
  const base = {
    manifestId: 'bazdidyar-domain-manifest',
    version: '1.0.0',
    files: [{id: 'coverage-catalog', kind: 'catalog', path: 'coverages/catalog.json'}]
  };
  assert.equal(Domain.validateManifest(base).files.length, 1);
  assert.throws(() => Domain.validateManifest({...base, files: [{id: 'bad', kind: 'catalog', path: '../secret.json'}]}), /UNSAFE_DOMAIN_PATH/);
  assert.throws(() => Domain.validateManifest({...base, files: [base.files[0], base.files[0]]}), /DUPLICATE_MANIFEST_ID/);
});

test('registry preserves versions and resolves latest', () => {
  const registry = new Domain.CatalogRegistry();
  registry.register({catalogId: 'coverage-catalog', version: '1.0.0'}, 'one.json');
  registry.register({catalogId: 'coverage-catalog', version: '1.1.0'}, 'two.json');
  assert.equal(registry.get('coverage-catalog', '1.0.0').__sourcePath, 'one.json');
  assert.equal(registry.get('coverage-catalog').version, '1.1.0');
  assert.throws(() => registry.register({catalogId: 'coverage-catalog', version: '1.1.0'}), /DUPLICATE_DOMAIN_ASSET/);
});

test('domain loader uses only manifest-listed files', async () => {
  const responses = new Map([
    ['./domain/manifest.json', {
      manifestId: 'bazdidyar-domain-manifest', version: '1.0.0',
      files: [{id: 'coverage-catalog', kind: 'catalog', path: 'coverages/catalog.json'}]
    }],
    ['./domain/coverages/catalog.json', {catalogId: 'coverage-catalog', version: '1.0.0'}]
  ]);
  const fakeFetch = async url => ({ok: responses.has(url), json: async () => responses.get(url)});
  const loaded = await Domain.loadDomain('./domain', fakeFetch);
  assert.equal(loaded.registry.get('coverage-catalog').version, '1.0.0');
  assert.equal(loaded.failures.length, 0);
});
