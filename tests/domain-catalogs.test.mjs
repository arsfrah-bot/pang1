import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const domainRoot = join(root, 'domain');

async function jsonFiles(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await jsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) output.push(full);
  }
  return output;
}

async function loadAll() {
  const loaded = [];
  for (const file of await jsonFiles(domainRoot)) {
    loaded.push({ file, data: JSON.parse(await readFile(file, 'utf8')) });
  }
  return loaded;
}

test('all domain assets contain valid JSON', async () => {
  const files = await jsonFiles(domainRoot);
  assert.ok(files.length >= 10, 'expected a meaningful domain registry');
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotThrow(
      () => JSON.parse(source),
      `invalid JSON: ${relative(root, file)}`
    );
  }
});

test('versioned top-level assets expose stable identity', async () => {
  for (const { file, data } of await loadAll()) {
    if (relative(domainRoot, file).startsWith('schemas')) continue;
    const stableId = data.id || data.catalogId || data.packId || data.conditionDocumentId || data.manifestId;
    assert.equal(typeof stableId, 'string', `missing stable ID: ${relative(root, file)}`);
    assert.match(stableId, /^[a-z0-9][a-z0-9._-]+$/, `unstable ID: ${relative(root, file)}`);
    assert.ok(data.version || data.catalogVersion || data.schemaVersion, `missing version: ${relative(root, file)}`);
  }
});

test('unknown special conditions cannot contain an approved deductible', async () => {
  for (const { file, data } of await loadAll()) {
    const conditions = Array.isArray(data.conditions) ? data.conditions :
      data.conditionDocumentId ? [data] : [];
    for (const condition of conditions) {
      if (!['officially-approved', 'expert-reviewed'].includes(condition.verificationStatus)) {
        assert.notEqual(
          condition.deductibleRule?.status,
          'approved',
          `unverified deductible marked approved: ${relative(root, file)}`
        );
      }
    }
  }
});

test('final coverage statuses require an authorized human', async () => {
  const file = join(domainRoot, 'statuses', 'coverage_decision_status_catalog.json');
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  const finalItems = catalog.items.filter(item => item.final);
  assert.equal(finalItems.length, 2);
  assert.ok(finalItems.every(item => item.requiresAuthorizedHuman === true));
  assert.equal(catalog.constraints.aiFinalDecisionAllowed, false);
  assert.equal(catalog.constraints.applicationFinalDecisionAllowed, false);
});

test('evidence classifications contain the required twelve states', async () => {
  const file = join(domainRoot, 'evidence', 'evidence_classification_catalog.json');
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  const expected = [
    'observed', 'photo-visible', 'insured-declared', 'representative-declared',
    'document-supported', 'policy-derived', 'equipment-plate', 'expert-inference',
    'calculation-derived', 'unavailable', 'requires-confirmation', 'contradictory'
  ];
  assert.deepEqual(catalog.items.map(item => item.id), expected);
});

test('product, activity, coverage, and duty items contain auditable metadata', async () => {
  const selected = [];
  for (const { file, data } of await loadAll()) {
    const path = relative(domainRoot, file).replace(/\\/g, '/');
    if (path.startsWith('products/') || path.startsWith('activities/')) selected.push(...(data.items || []));
    if (path.startsWith('coverages/')) selected.push(...(data.coveragePacks || []));
    if (path.startsWith('duties/')) selected.push(...(data.duties || []));
  }
  assert.ok(selected.length >= 30);
  const keys = [
    'id', 'titleFa', 'descriptionFa', 'status', 'version', 'effectiveDate',
    'expirationDate', 'sourceRefs', 'approvingAuthority', 'applicableProductIds',
    'applicableActivityIds', 'conditions', 'dependencies', 'incompatibilities',
    'reportBindings', 'audit'
  ];
  for (const item of selected) {
    for (const key of keys) {
      assert.ok(Object.hasOwn(item, key), `${item.id} is missing ${key}`);
    }
  }
});

test('special condition documents retain source, validity, evidence, and approval fields', async () => {
  const file = join(domainRoot, 'conditions', 'special-fire.conditions.v1.json');
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(catalog.conditions.length, 10);
  const keys = [
    'conditionDocumentId', 'titleFa', 'insurer', 'documentSource', 'sourceImageOrFile',
    'documentVersion', 'effectiveDate', 'verificationStatus', 'applicableProductFamilies',
    'coverageTrigger', 'coverageScope', 'exclusions', 'deductibleFormula',
    'minimumDeductible', 'dutiesOfInsured', 'requiredEvidence', 'inspectionQuestions',
    'claimQuestions', 'reportWording', 'approvalAuthority', 'supersededStatus', 'audit'
  ];
  for (const condition of catalog.conditions) {
    for (const key of keys) assert.ok(Object.hasOwn(condition, key), `${condition.id} is missing ${key}`);
    assert.equal(condition.deductibleFormula.formula, null);
    assert.equal(condition.minimumDeductible.amount, null);
    assert.equal(condition.approvalAuthority.automaticApprovalAllowed, false);
  }
});
