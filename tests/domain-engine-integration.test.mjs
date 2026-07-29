import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const Engine = require('../app/src/main/assets/bazdidyar_pwa/engine/coverage-engine.js');

test('the engine evaluates an actual versioned claim pack by coverageRef', async () => {
  const file = join(root, 'domain', 'claim-packs', 'burst-pipe-internal-water.json');
  const pack = JSON.parse(await readFile(file, 'utf8'));
  const result = Engine.evaluateCoverage(pack, {
    selectedCoverageId: pack.coverageRef,
    facts: {
      claim: {
        selectedCoverageIds: [pack.coverageRef],
        lossReported: true
      }
    }
  });
  assert.equal(result.selectedCoverage.id, pack.coverageRef);
  assert.equal(result.selectedCoverage.title, pack.titleFa);
  assert.equal(result.triggerMatched, true);
  assert.notEqual(result.status, Engine.STATUS.OUTSIDE_SELECTED_COVERAGE);
  assert.equal(result.isFinal, false);
  assert.equal(result.requiresAuthorizedHumanDecision, true);
});
