import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const domain = join(root, 'domain');
const readJson = async (...parts) => JSON.parse(await readFile(join(domain, ...parts), 'utf8'));

async function filesIn(folder) {
  return (await readdir(join(domain, folder))).filter(name => name.endsWith('.json'));
}

async function coverageItems() {
  const output = [];
  for (const file of await filesIn('coverages')) {
    const data = await readJson('coverages', file);
    output.push(...(data.coveragePacks || []));
  }
  return output;
}

test('ten special coverages have exact condition, claim, photo, and duty references', async () => {
  const coverages = await coverageItems();
  const conditions = (await readJson('conditions', 'special-fire.conditions.v1.json')).conditions;
  const duties = (await readJson('duties', 'insured-duties.v1.json')).duties;
  const claimCatalog = await readJson('claim-packs', 'catalog.json');
  const photoCatalog = await readJson('photo-requirements', 'catalog.json');
  const conditionIds = new Set(conditions.map(item => item.id));
  const dutyIds = new Set(duties.map(item => item.id));
  const claimIds = new Set(claimCatalog.packs.map(item => item.id));
  const photoIds = new Set(photoCatalog.packs.map(item => item.id));

  assert.equal(coverages.length, 10, 'expected eight water covers plus theft and glass');
  assert.equal(conditionIds.size, 10, 'every special cover needs its own condition record');
  assert.equal(claimIds.size, 10, 'every special cover needs its own claim pack');
  assert.equal(photoIds.size, 10, 'every special cover needs its own photo pack');

  for (const coverage of coverages) {
    assert.ok(claimIds.has(coverage.dependencies.claimPackId), `missing claim pack for ${coverage.id}`);
    assert.ok(photoIds.has(coverage.dependencies.photoPackId), `missing photo pack for ${coverage.id}`);
    for (const id of coverage.dependencies.conditionIds || []) {
      assert.ok(conditionIds.has(id), `missing condition ${id}`);
    }
    for (const id of coverage.dependencies.dutyIds || []) {
      assert.ok(dutyIds.has(id), `missing duty ${id}`);
    }
  }
});

test('claim and photo catalog entries match their files and coverage references', async () => {
  const coverageIds = new Set((await coverageItems()).map(item => item.id));
  const claimCatalog = await readJson('claim-packs', 'catalog.json');
  const photoCatalog = await readJson('photo-requirements', 'catalog.json');
  const photoIds = new Set(photoCatalog.packs.map(item => item.id));

  for (const entry of claimCatalog.packs) {
    const pack = await readJson('claim-packs', entry.file);
    assert.equal(pack.id, entry.id, `claim catalog/file mismatch: ${entry.file}`);
    assert.ok(coverageIds.has(pack.coverageRef), `unknown coverageRef in ${entry.file}`);
    assert.ok(photoIds.has(entry.photoRequirementPackId), `unknown photo pack in ${entry.file}`);
  }

  const claimIds = new Set(claimCatalog.packs.map(item => item.id));
  for (const entry of photoCatalog.packs) {
    const pack = await readJson('photo-requirements', entry.file);
    assert.equal(pack.id, entry.id, `photo catalog/file mismatch: ${entry.file}`);
    assert.ok(claimIds.has(entry.claimPackRef), `unknown claimPackRef in ${entry.file}`);
  }
});

test('all claim decisions use the canonical non-final and human-only statuses', async () => {
  const statusCatalog = await readJson('statuses', 'coverage_decision_status_catalog.json');
  const allowed = new Set(statusCatalog.items.map(item => item.id));
  const claimCatalog = await readJson('claim-packs', 'catalog.json');
  for (const entry of claimCatalog.packs) {
    const pack = await readJson('claim-packs', entry.file);
    assert.equal(pack.decisionPolicy.automatedFinalDecision, false);
    assert.equal(pack.decisionPolicy.authorizedHumanDecisionRequired, true);
    for (const status of pack.decisionPolicy.allowedMachineStatuses || []) {
      assert.ok(allowed.has(status), `unknown machine status ${status} in ${entry.file}`);
      assert.equal(statusCatalog.items.find(item => item.id === status).final, false);
    }
    for (const status of pack.decisionPolicy.humanOnlyStatuses || []) {
      assert.ok(allowed.has(status), `unknown human status ${status} in ${entry.file}`);
      assert.equal(statusCatalog.items.find(item => item.id === status).requiresAuthorizedHuman, true);
    }
  }
});

test('no special coverage contains a hardcoded deductible figure', async () => {
  const coverages = await coverageItems();
  for (const coverage of coverages) {
    assert.notEqual(coverage.deductibleRule.status, 'approved');
    assert.equal(coverage.deductibleRule.formula, null);
    assert.equal(coverage.deductibleRule.minimum, null);
  }
  const claimCatalog = await readJson('claim-packs', 'catalog.json');
  for (const entry of claimCatalog.packs) {
    const pack = await readJson('claim-packs', entry.file);
    assert.equal(pack.deductibleRule.hardcodedAmountAllowed, false);
  }
});
