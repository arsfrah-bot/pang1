import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(
  testDir,
  '../app/src/main/assets/bazdidyar_pwa/engine/coverage-engine.js'
);
const require = createRequire(import.meta.url);
const engine = require(enginePath);

const pack = Object.freeze({
  id: 'coverage.fire.burst-pipe',
  persianTitle: 'ترکیدگی لوله آب',
  conditionDocumentId: 'condition.fire.water.001',
  documentVersion: '2026-draft-1',
  coverageTrigger: {
    all: [
      { fact: 'loss.source', operator: 'eq', value: 'internal-pipe' },
      { fact: 'loss.sudden', operator: 'eq', value: true }
    ]
  },
  requiredEvidence: [
    { id: 'photo-before-repair', title: 'عکس پیش از تعمیر' },
    { id: 'plumber-report', title: 'گزارش لوله‌کش' }
  ],
  potentialExclusions: [
    {
      id: 'wear-and-tear',
      title: 'استهلاک تدریجی',
      when: { fact: 'loss.gradual', operator: 'eq', value: true }
    }
  ],
  deductibleRuleReference: {
    id: 'deductible.fire.water',
    version: '2026-01',
    sourceDocument: 'condition.fire.water.001',
    formulaRef: 'catalog://deductibles/fire/water/2026-01'
  },
  duties: [
    {
      id: 'stop-leak',
      title: 'توقف نشت آب',
      complianceFact: 'duties.stopLeak'
    }
  ],
  approvalAuthority: ['senior-claims-expert'],
  decisionPolicy: {
    enforceApprovalAuthority: true,
    approvalAuthority: ['senior-claims-expert']
  },
  reportWording: {
    potentiallyApplicable: 'پوشش با اطلاعات فعلی بالقوه قابل بررسی است.',
    potentialExclusion: 'یک استثنای احتمالی نیازمند بررسی کارشناس است.'
  }
});

const completeData = () => ({
  selectedCoverageId: 'coverage.fire.burst-pipe',
  facts: {
    loss: { source: 'internal-pipe', sudden: true, gradual: false },
    duties: { stopLeak: true }
  },
  evidence: [
    { id: 'photo-before-repair', reference: 'photo:1' },
    { id: 'plumber-report', reference: 'document:2' }
  ]
});

function assertOnlyAllowedStatuses(result) {
  for (const key of ['status', 'systemAssessmentStatus', 'expertDecisionStatus', 'finalApprovalStatus']) {
    assert.ok(engine.ALLOWED_STATUSES.includes(result[key]), `${key} must be allowed`);
  }
}

test('exports one immutable allow-list containing the eight specified statuses', () => {
  assert.deepEqual(engine.ALLOWED_STATUSES, [
    'potentially-applicable',
    'not-yet-established',
    'additional-evidence-required',
    'potential-exclusion',
    'outside-selected-coverage',
    'requires-senior-review',
    'approved-by-authorized-user',
    'rejected-by-authorized-user'
  ]);
  assert.ok(Object.isFrozen(engine.ALLOWED_STATUSES));
});

test('evaluates trigger facts, evidence, deductible reference, and duties', () => {
  const result = engine.evaluateCoverage(pack, completeData());

  assert.equal(result.triggerMatched, true);
  assert.equal(result.triggerFacts.length, 2);
  assert.ok(result.triggerFacts.every((fact) => fact.matched === true));
  assert.deepEqual(result.supportingEvidence.map((item) => item.id).sort(), [
    'photo-before-repair',
    'plumber-report'
  ]);
  assert.deepEqual(result.missingEvidence, []);
  assert.equal(result.deductibleRuleReference.id, 'deductible.fire.water');
  assert.equal(result.deductibleRuleReference.version, '2026-01');
  assert.equal(result.duties[0].performed, true);
  assert.equal(result.systemAssessmentStatus, engine.STATUS.POTENTIALLY_APPLICABLE);
  assert.equal(result.isFinal, false);
  assert.equal(result.finalApprovalStatus, engine.STATUS.REQUIRES_SENIOR_REVIEW);
  assertOnlyAllowedStatuses(result);
});

test('reports missing evidence without making a final decision', () => {
  const data = completeData();
  data.evidence = ['photo-before-repair'];
  const result = engine.evaluateCoverage({ pack, data });

  assert.deepEqual(result.missingEvidence.map((item) => item.id), ['plumber-report']);
  assert.equal(result.status, engine.STATUS.ADDITIONAL_EVIDENCE_REQUIRED);
  assert.equal(result.isFinal, false);
  assert.equal(result.requiresAuthorizedHumanDecision, true);
  assertOnlyAllowedStatuses(result);
});

test('flags a matched configurable exclusion as potential, never as rejected', () => {
  const data = completeData();
  data.facts.loss.gradual = true;
  const result = engine.evaluateCoverage(pack, data);

  assert.equal(result.potentialExclusions[0].matched, true);
  assert.equal(result.systemAssessmentStatus, engine.STATUS.POTENTIAL_EXCLUSION);
  assert.notEqual(result.status, engine.STATUS.REJECTED);
  assert.equal(result.isFinal, false);
  assertOnlyAllowedStatuses(result);
});

test('records failure of an insured duty and refers it for senior review', () => {
  const data = completeData();
  data.facts.duties.stopLeak = false;
  const result = engine.evaluateCoverage(pack, data);

  assert.equal(result.duties[0].performed, false);
  assert.match(result.duties[0].warning, /کارشناس مجاز/);
  assert.equal(result.status, engine.STATUS.REQUIRES_SENIOR_REVIEW);
  assert.equal(result.isFinal, false);
  assertOnlyAllowedStatuses(result);
});

test('does not synthesize approval or rejection from pack data or incomplete decisions', () => {
  const hostilePack = {
    ...pack,
    status: 'approved-by-authorized-user',
    finalApprovalStatus: 'rejected-by-authorized-user'
  };
  const attempts = [
    undefined,
    { decision: 'approved' },
    { decision: 'rejected', authorized: true },
    { decision: 'approved-by-authorized-user', authorized: true, userId: '' }
  ];

  for (const authorizedHumanDecision of attempts) {
    const data = { ...completeData(), authorizedHumanDecision };
    const result = engine.evaluateCoverage(hostilePack, data);
    assert.equal(result.isFinal, false);
    assert.notEqual(result.status, engine.STATUS.APPROVED);
    assert.notEqual(result.status, engine.STATUS.REJECTED);
    assert.equal(result.finalApprovalStatus, engine.STATUS.REQUIRES_SENIOR_REVIEW);
    assertOnlyAllowedStatuses(result);
  }
});

test('accepts a final decision only from an identified authorized human with authority', () => {
  for (const [decision, expected] of [
    ['approved', engine.STATUS.APPROVED],
    ['rejected', engine.STATUS.REJECTED]
  ]) {
    const data = completeData();
    data.authorizedHumanDecision = {
      decision,
      authorized: true,
      userId: 'expert-42',
      authority: 'senior-claims-expert',
      decisionId: `audit-${decision}`,
      decidedAt: '2026-07-28T08:30:00+03:30'
    };
    const result = engine.evaluateCoverage(pack, data);

    assert.equal(result.status, expected);
    assert.equal(result.finalApprovalStatus, expected);
    assert.equal(result.isFinal, true);
    assert.equal(result.authorizedHumanDecision.userId, 'expert-42');
    assert.equal(result.systemAssessmentStatus, engine.STATUS.POTENTIALLY_APPLICABLE);
    assertOnlyAllowedStatuses(result);
  }
});

test('rejects a human decision that lacks the enforced configured authority', () => {
  const data = completeData();
  data.authorizedHumanDecision = {
    decision: 'approved',
    authorized: true,
    userId: 'junior-7',
    authority: 'junior-adjuster'
  };
  const result = engine.evaluateCoverage(pack, data);

  assert.equal(result.isFinal, false);
  assert.equal(result.status, engine.STATUS.POTENTIALLY_APPLICABLE);
  assert.ok(result.diagnostics.some((item) => item.code === 'INSUFFICIENT_DECISION_AUTHORITY'));
  assertOnlyAllowedStatuses(result);
});

test('returns outside selected coverage and not-established states deterministically', () => {
  const outside = completeData();
  outside.selectedCoverageId = 'coverage.fire.flood';
  const outsideResult = engine.evaluateCoverage(pack, outside);
  assert.equal(outsideResult.status, engine.STATUS.OUTSIDE_SELECTED_COVERAGE);

  const noTrigger = completeData();
  noTrigger.facts.loss.source = 'roof';
  const noTriggerResult = engine.evaluateCoverage(pack, noTrigger);
  assert.equal(noTriggerResult.triggerMatched, false);
  assert.equal(noTriggerResult.status, engine.STATUS.NOT_ESTABLISHED);
  assertOnlyAllowedStatuses(outsideResult);
  assertOnlyAllowedStatuses(noTriggerResult);
});

test('fails closed for unsupported operators and blocked fact paths', () => {
  const unknown = engine.evaluateRule(
    { fact: 'loss.source', operator: 'executeScript', value: 'anything' },
    completeData().facts
  );
  assert.equal(unknown.matched, null);
  assert.ok(unknown.diagnostics.some((item) => item.code === 'UNSUPPORTED_OPERATOR'));

  const blocked = engine.evaluateRule(
    { fact: '__proto__.polluted', operator: 'exists' },
    completeData().facts
  );
  assert.equal(blocked.matched, null);
  assert.ok(blocked.diagnostics.some((item) => item.code === 'UNSAFE_FACT_PATH'));
  assert.equal({}.polluted, undefined);
});

test('source has no dynamic code execution and the UMD build works in a browser-like context', () => {
  const source = fs.readFileSync(enginePath, 'utf8');
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);

  const context = { Object, Array, String, Number, Boolean, Math, RegExp };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'coverage-engine.js' });
  assert.equal(typeof context.BazdidyarCoverageEngine.evaluateCoverage, 'function');
  assert.equal(
    context.BazdidyarCoverageEngine.evaluateCoverage(pack, completeData()).triggerMatched,
    true
  );
});
