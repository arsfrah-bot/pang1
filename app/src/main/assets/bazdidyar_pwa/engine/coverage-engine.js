(function (root, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof define === 'function' && define.amd) {
    define([], function () { return api; });
  }
  if (root) {
    root.BazdidyarCoverageEngine = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENGINE_VERSION = '1.0.0';
  var MAX_RULE_DEPTH = 32;
  var MAX_COLLECTION_SIZE = 500;
  var BLOCKED_PATH_PARTS = Object.freeze({
    '__proto__': true,
    'prototype': true,
    'constructor': true
  });

  var STATUS = Object.freeze({
    POTENTIALLY_APPLICABLE: 'potentially-applicable',
    NOT_ESTABLISHED: 'not-yet-established',
    ADDITIONAL_EVIDENCE_REQUIRED: 'additional-evidence-required',
    POTENTIAL_EXCLUSION: 'potential-exclusion',
    OUTSIDE_SELECTED_COVERAGE: 'outside-selected-coverage',
    REQUIRES_SENIOR_REVIEW: 'requires-senior-review',
    APPROVED: 'approved-by-authorized-user',
    REJECTED: 'rejected-by-authorized-user'
  });

  var ALLOWED_STATUSES = Object.freeze([
    STATUS.POTENTIALLY_APPLICABLE,
    STATUS.NOT_ESTABLISHED,
    STATUS.ADDITIONAL_EVIDENCE_REQUIRED,
    STATUS.POTENTIAL_EXCLUSION,
    STATUS.OUTSIDE_SELECTED_COVERAGE,
    STATUS.REQUIRES_SENIOR_REVIEW,
    STATUS.APPROVED,
    STATUS.REJECTED
  ]);

  var hasOwn = function (value, key) {
    return value !== null && value !== undefined &&
      Object.prototype.hasOwnProperty.call(Object(value), key);
  };

  var isObject = function (value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  };

  var asNonEmptyString = function (value) {
    if (typeof value !== 'string') return null;
    var result = value.trim();
    return result ? result : null;
  };

  var firstDefined = function () {
    for (var index = 0; index < arguments.length; index += 1) {
      if (arguments[index] !== undefined && arguments[index] !== null) {
        return arguments[index];
      }
    }
    return undefined;
  };

  var toArray = function (value) {
    if (Array.isArray(value)) return value.slice(0, MAX_COLLECTION_SIZE);
    if (value === undefined || value === null) return [];
    if (isObject(value)) {
      return Object.keys(value).slice(0, MAX_COLLECTION_SIZE).map(function (key) {
        var item = value[key];
        if (isObject(item) && !hasOwn(item, 'id')) {
          var copy = {};
          Object.keys(item).forEach(function (itemKey) { copy[itemKey] = item[itemKey]; });
          copy.id = key;
          return copy;
        }
        return item;
      });
    }
    return [value];
  };

  var safeScalar = function (value) {
    if (value === null || value === undefined ||
        typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return value.length > 500 ? value.slice(0, 500) : value;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map(function (item) {
        return (item === null || ['string', 'number', 'boolean'].indexOf(typeof item) >= 0)
          ? safeScalar(item)
          : '[complex value]';
      });
    }
    return '[complex value]';
  };

  function addDiagnostic(diagnostics, code, message, reference) {
    diagnostics.push({
      code: code,
      message: message,
      reference: reference || null
    });
  }

  function pathParts(path) {
    var parts = Array.isArray(path)
      ? path.slice()
      : (typeof path === 'string' ? path.split('.') : []);

    if (!parts.length || parts.length > MAX_RULE_DEPTH) return null;
    for (var index = 0; index < parts.length; index += 1) {
      var part = String(parts[index]).trim();
      if (!part || BLOCKED_PATH_PARTS[part]) return null;
      parts[index] = part;
    }
    return parts;
  }

  function resolvePath(source, path) {
    var parts = pathParts(path);
    if (!parts) return { exists: false, value: undefined, unsafe: true };

    var current = source;
    for (var index = 0; index < parts.length; index += 1) {
      if (current === null || current === undefined ||
          (typeof current !== 'object' && typeof current !== 'function') ||
          !hasOwn(current, parts[index])) {
        return { exists: false, value: undefined, unsafe: false };
      }
      current = current[parts[index]];
    }
    return { exists: true, value: current, unsafe: false };
  }

  function normalizeDigits(value) {
    return String(value)
      .replace(/[\u06F0-\u06F9]/g, function (digit) {
        return String(digit.charCodeAt(0) - 0x06F0);
      })
      .replace(/[\u0660-\u0669]/g, function (digit) {
        return String(digit.charCodeAt(0) - 0x0660);
      });
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    var normalized = normalizeDigits(value).replace(/[ ,\u066C]/g, '').trim();
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
    var converted = Number(normalized);
    return Number.isFinite(converted) ? converted : null;
  }

  function sameValue(actual, expected) {
    if (typeof actual === 'number' && typeof expected === 'number') {
      return Number.isFinite(actual) && Number.isFinite(expected) && actual === expected;
    }
    return actual === expected;
  }

  function applyOperator(operator, actual, expected, available) {
    switch (operator) {
      case 'exists':
        return available === (expected === undefined ? true : Boolean(expected));
      case 'eq':
        return available ? sameValue(actual, expected) : null;
      case 'neq':
        return available ? !sameValue(actual, expected) : null;
      case 'in':
        return available && Array.isArray(expected)
          ? expected.some(function (item) { return sameValue(actual, item); })
          : (available ? null : null);
      case 'notIn':
        return available && Array.isArray(expected)
          ? !expected.some(function (item) { return sameValue(actual, item); })
          : (available ? null : null);
      case 'contains':
        if (!available) return null;
        if (Array.isArray(actual)) {
          return actual.some(function (item) { return sameValue(item, expected); });
        }
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.indexOf(expected) >= 0;
        }
        return null;
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (!available) return null;
        var left = finiteNumber(actual);
        var right = finiteNumber(expected);
        if (left === null || right === null) return null;
        if (operator === 'gt') return left > right;
        if (operator === 'gte') return left >= right;
        if (operator === 'lt') return left < right;
        return left <= right;
      }
      case 'truthy':
        return available ? Boolean(actual) : null;
      case 'falsy':
        return available ? !Boolean(actual) : null;
      default:
        return null;
    }
  }

  function evaluateLeaf(rule, facts, collector, diagnostics) {
    var factPath = firstDefined(rule.fact, rule.path, rule.field);
    var factName = typeof factPath === 'string' ? factPath : String(factPath || '');
    var operator = firstDefined(rule.operator, rule.op,
      hasOwn(rule, 'equals') ? 'eq' : undefined, 'truthy');
    var expected = firstDefined(rule.value, rule.expected, rule.equals);
    var resolved = resolvePath(facts, factPath);
    var supportedOperators = [
      'exists', 'eq', 'neq', 'in', 'notIn', 'contains',
      'gt', 'gte', 'lt', 'lte', 'truthy', 'falsy'
    ];

    if (resolved.unsafe) {
      addDiagnostic(diagnostics, 'UNSAFE_FACT_PATH',
        'A blocked or invalid fact path was ignored.', factName);
    }
    if (supportedOperators.indexOf(operator) < 0) {
      addDiagnostic(diagnostics, 'UNSUPPORTED_OPERATOR',
        'The declarative rule uses an unsupported operator.', String(operator));
    }

    var matched = (!factName || resolved.unsafe || supportedOperators.indexOf(operator) < 0)
      ? null
      : applyOperator(operator, resolved.value, expected, resolved.exists);
    var factResult = {
      fact: factName || null,
      label: asNonEmptyString(firstDefined(rule.label, rule.title, rule.persianTitle)),
      operator: String(operator),
      expected: safeScalar(expected),
      actual: resolved.exists ? safeScalar(resolved.value) : null,
      available: resolved.exists,
      matched: matched
    };
    collector.push(factResult);
    return { matched: matched };
  }

  function combineAll(results) {
    if (!results.length) return null;
    if (results.some(function (item) { return item.matched === false; })) return false;
    if (results.every(function (item) { return item.matched === true; })) return true;
    return null;
  }

  function combineAny(results) {
    if (!results.length) return null;
    if (results.some(function (item) { return item.matched === true; })) return true;
    if (results.every(function (item) { return item.matched === false; })) return false;
    return null;
  }

  function evaluateRuleInternal(rule, facts, collector, diagnostics, state, depth) {
    if (depth > MAX_RULE_DEPTH) {
      addDiagnostic(diagnostics, 'RULE_DEPTH_EXCEEDED',
        'The rule exceeded the maximum supported nesting depth.', null);
      return { matched: null };
    }
    if (rule === null || rule === undefined) return { matched: null };
    if (typeof rule === 'string') {
      return evaluateLeaf({ fact: rule, operator: 'truthy' }, facts, collector, diagnostics);
    }
    if (Array.isArray(rule)) {
      return {
        matched: combineAll(rule.slice(0, MAX_COLLECTION_SIZE).map(function (item) {
          return evaluateRuleInternal(item, facts, collector, diagnostics, state, depth + 1);
        }))
      };
    }
    if (!isObject(rule)) {
      addDiagnostic(diagnostics, 'INVALID_RULE',
        'Only declarative rule objects, arrays, and fact paths are accepted.', null);
      return { matched: null };
    }
    if (state.stack.indexOf(rule) >= 0) {
      addDiagnostic(diagnostics, 'CYCLIC_RULE', 'A cyclic rule was ignored.', null);
      return { matched: null };
    }

    state.stack.push(rule);
    var result;
    try {
      if (Array.isArray(rule.all)) {
        result = {
          matched: combineAll(rule.all.slice(0, MAX_COLLECTION_SIZE).map(function (item) {
            return evaluateRuleInternal(item, facts, collector, diagnostics, state, depth + 1);
          }))
        };
      } else if (Array.isArray(rule.any)) {
        result = {
          matched: combineAny(rule.any.slice(0, MAX_COLLECTION_SIZE).map(function (item) {
            return evaluateRuleInternal(item, facts, collector, diagnostics, state, depth + 1);
          }))
        };
      } else if (hasOwn(rule, 'not')) {
        var child = evaluateRuleInternal(rule.not, facts, collector, diagnostics, state, depth + 1);
        result = { matched: child.matched === null ? null : !child.matched };
      } else if (Array.isArray(rule.rules)) {
        result = {
          matched: combineAll(rule.rules.slice(0, MAX_COLLECTION_SIZE).map(function (item) {
            return evaluateRuleInternal(item, facts, collector, diagnostics, state, depth + 1);
          }))
        };
      } else {
        result = evaluateLeaf(rule, facts, collector, diagnostics);
      }
    } finally {
      state.stack.pop();
    }
    return result;
  }

  function evaluateRule(rule, facts) {
    var collector = [];
    var diagnostics = [];
    var result = evaluateRuleInternal(
      rule,
      isObject(facts) ? facts : {},
      collector,
      diagnostics,
      { stack: [] },
      0
    );
    return {
      matched: result.matched,
      facts: collector,
      diagnostics: diagnostics
    };
  }

  function normalizeEvidenceInput(value) {
    var index = Object.create(null);

    if (Array.isArray(value)) {
      value.slice(0, MAX_COLLECTION_SIZE).forEach(function (item) {
        if (typeof item === 'string') {
          index[item] = { id: item, provided: true };
          return;
        }
        if (!isObject(item)) return;
        var id = asNonEmptyString(firstDefined(item.id, item.evidenceId, item.key));
        if (!id || BLOCKED_PATH_PARTS[id]) return;
        index[id] = {
          id: id,
          provided: item.provided !== false && item.available !== false,
          reference: safeScalar(firstDefined(item.reference, item.fileId, item.documentId)),
          kind: asNonEmptyString(firstDefined(item.kind, item.type)),
          label: asNonEmptyString(firstDefined(item.label, item.title, item.persianTitle))
        };
      });
      return index;
    }

    if (isObject(value)) {
      Object.keys(value).slice(0, MAX_COLLECTION_SIZE).forEach(function (id) {
        if (!id || BLOCKED_PATH_PARTS[id]) return;
        var item = value[id];
        if (isObject(item)) {
          index[id] = {
            id: id,
            provided: item.provided !== false && item.available !== false,
            reference: safeScalar(firstDefined(item.reference, item.fileId, item.documentId)),
            kind: asNonEmptyString(firstDefined(item.kind, item.type)),
            label: asNonEmptyString(firstDefined(item.label, item.title, item.persianTitle))
          };
        } else {
          index[id] = { id: id, provided: Boolean(item) };
        }
      });
    }
    return index;
  }

  function evidenceRequirements(pack) {
    var configured = firstDefined(pack.requiredEvidence, pack.evidenceRequirements);
    if (configured === undefined && isObject(pack.evidence)) configured = pack.evidence.required;
    if (configured === undefined && Array.isArray(pack.evidence)) configured = pack.evidence;
    return toArray(configured).map(function (item, index) {
      if (typeof item === 'string') {
        return { id: item, title: item, required: true, when: null, raw: item };
      }
      item = isObject(item) ? item : {};
      var id = asNonEmptyString(firstDefined(item.id, item.evidenceId, item.key)) ||
        ('evidence-' + String(index + 1));
      return {
        id: id,
        title: asNonEmptyString(firstDefined(item.label, item.title, item.persianTitle)) || id,
        required: item.required !== false,
        when: firstDefined(item.when, item.condition, item.requiredWhen),
        fact: firstDefined(item.evidenceFact, item.fact),
        conditionDocumentId: asNonEmptyString(item.conditionDocumentId),
        raw: item
      };
    });
  }

  function requirementProvided(requirement, evidenceIndex, facts) {
    if (hasOwn(evidenceIndex, requirement.id) && evidenceIndex[requirement.id].provided) return true;
    if (requirement.fact !== undefined) {
      var resolved = resolvePath(facts, requirement.fact);
      return resolved.exists && Boolean(resolved.value);
    }
    return false;
  }

  function evaluateEvidence(pack, data, facts, diagnostics) {
    var evidenceIndex = normalizeEvidenceInput(firstDefined(data.evidence, data.supportingEvidence));
    var requirements = evidenceRequirements(pack);
    var missing = [];

    requirements.forEach(function (requirement) {
      if (!requirement.required) return;
      var applicability = requirement.when === undefined || requirement.when === null
        ? { matched: true }
        : evaluateRule(requirement.when, facts);
      if (applicability.diagnostics) {
        Array.prototype.push.apply(diagnostics, applicability.diagnostics);
      }
      if (applicability.matched === false || requirementProvided(requirement, evidenceIndex, facts)) return;
      missing.push({
        id: requirement.id,
        title: requirement.title,
        conditionDocumentId: requirement.conditionDocumentId,
        applicabilityIndeterminate: applicability.matched === null
      });
    });

    var supporting = Object.keys(evidenceIndex).filter(function (id) {
      return evidenceIndex[id].provided;
    }).map(function (id) {
      var item = evidenceIndex[id];
      var configured = requirements.find(function (requirement) { return requirement.id === id; });
      return {
        id: id,
        title: item.label || (configured ? configured.title : id),
        reference: item.reference || null,
        kind: item.kind || null
      };
    });

    return {
      index: evidenceIndex,
      supporting: supporting,
      missing: missing
    };
  }

  function normalizeSignals(value) {
    var signals = Object.create(null);
    if (Array.isArray(value)) {
      value.slice(0, MAX_COLLECTION_SIZE).forEach(function (item) {
        if (typeof item === 'string') signals[item] = true;
        else if (isObject(item)) {
          var id = asNonEmptyString(firstDefined(item.id, item.exclusionId, item.key));
          if (id && !BLOCKED_PATH_PARTS[id]) {
            signals[id] = firstDefined(item.matched, item.present, item.active, true) === true;
          }
        }
      });
    } else if (isObject(value)) {
      Object.keys(value).slice(0, MAX_COLLECTION_SIZE).forEach(function (key) {
        if (!BLOCKED_PATH_PARTS[key]) {
          var item = value[key];
          signals[key] = isObject(item)
            ? firstDefined(item.matched, item.present, item.active, false) === true
            : item === true;
        }
      });
    }
    return signals;
  }

  function evaluateExclusions(pack, data, facts, diagnostics) {
    var definitions = toArray(firstDefined(pack.potentialExclusions, pack.exclusions));
    var explicit = normalizeSignals(firstDefined(data.potentialExclusions, data.exclusions));

    return definitions.map(function (item, index) {
      if (typeof item === 'string') item = { id: item, title: item };
      item = isObject(item) ? item : {};
      var id = asNonEmptyString(firstDefined(item.id, item.exclusionId, item.key)) ||
        ('exclusion-' + String(index + 1));
      var condition = firstDefined(item.when, item.condition, item.trigger);
      var matched;
      var factsUsed = [];

      if (hasOwn(explicit, id)) {
        matched = explicit[id];
      } else if (condition !== undefined && condition !== null) {
        var evaluated = evaluateRule(condition, facts);
        matched = evaluated.matched;
        factsUsed = evaluated.facts;
        Array.prototype.push.apply(diagnostics, evaluated.diagnostics);
      } else {
        matched = null;
      }

      return {
        id: id,
        title: asNonEmptyString(firstDefined(item.label, item.title, item.persianTitle)) || id,
        conditionDocumentId: asNonEmptyString(item.conditionDocumentId),
        matched: matched,
        requiresAssessment: item.requiresAssessment === true || item.requiresReview === true,
        triggerFacts: factsUsed
      };
    });
  }

  function normalizeDutySignals(value) {
    var signals = Object.create(null);
    if (Array.isArray(value)) {
      value.slice(0, MAX_COLLECTION_SIZE).forEach(function (item) {
        if (!isObject(item)) return;
        var id = asNonEmptyString(firstDefined(item.id, item.dutyId, item.key));
        if (!id || BLOCKED_PATH_PARTS[id]) return;
        signals[id] = firstDefined(item.performed, item.fulfilled, item.completed);
      });
    } else if (isObject(value)) {
      Object.keys(value).slice(0, MAX_COLLECTION_SIZE).forEach(function (id) {
        if (BLOCKED_PATH_PARTS[id]) return;
        var item = value[id];
        signals[id] = isObject(item)
          ? firstDefined(item.performed, item.fulfilled, item.completed)
          : item;
      });
    }
    return signals;
  }

  function evaluateDuties(pack, data, facts, evidenceIndex, diagnostics) {
    var definitions = toArray(firstDefined(pack.duties, pack.dutiesOfInsured));
    var signals = normalizeDutySignals(data.duties);
    var output = [];

    definitions.forEach(function (item, index) {
      if (typeof item === 'string') item = { id: item, title: item };
      item = isObject(item) ? item : {};
      var id = asNonEmptyString(firstDefined(item.id, item.dutyId, item.key)) ||
        ('duty-' + String(index + 1));
      var condition = firstDefined(item.when, item.condition, item.appliesWhen);
      var applicability = condition === undefined || condition === null
        ? { matched: true, diagnostics: [] }
        : evaluateRule(condition, facts);
      Array.prototype.push.apply(diagnostics, applicability.diagnostics || []);
      if (applicability.matched === false) return;

      var performed = hasOwn(signals, id) ? signals[id] : undefined;
      if (performed === undefined) {
        var complianceFact = firstDefined(item.complianceFact, item.performedFact);
        if (complianceFact !== undefined) {
          var resolved = resolvePath(facts, complianceFact);
          performed = resolved.exists ? Boolean(resolved.value) : undefined;
        }
      }
      if (performed === undefined && item.evidenceId && hasOwn(evidenceIndex, item.evidenceId)) {
        performed = evidenceIndex[item.evidenceId].provided;
      }
      performed = performed === true ? true : (performed === false ? false : null);

      output.push({
        id: id,
        title: asNonEmptyString(firstDefined(item.label, item.title, item.persianTitle,
          item.description)) || id,
        conditionDocumentId: asNonEmptyString(item.conditionDocumentId),
        applicable: applicability.matched,
        performed: performed,
        warning: performed === false
          ? 'عدم انجام وظیفه ثبت شد؛ نتیجه حقوقی فقط توسط کارشناس مجاز تعیین می‌شود.'
          : null
      });
    });
    return output;
  }

  function deductibleReference(pack) {
    var configured = firstDefined(
      pack.deductibleRuleReference,
      pack.deductibleRuleRef,
      pack.deductibleRule
    );
    if (configured === undefined || configured === null) return null;
    if (typeof configured === 'string') return { id: configured, version: null };
    if (!isObject(configured)) return null;
    return {
      id: asNonEmptyString(firstDefined(configured.id, configured.ruleId, configured.reference)),
      version: asNonEmptyString(firstDefined(configured.version, configured.ruleVersion)),
      sourceDocument: asNonEmptyString(firstDefined(
        configured.sourceDocument,
        configured.conditionDocumentId,
        configured.documentId
      )),
      formula: safeScalar(firstDefined(configured.formula, configured.formulaRef)),
      minimum: safeScalar(firstDefined(configured.minimum, configured.minimumDeductible)),
      verification: safeScalar(firstDefined(configured.verification, configured.verificationStatus))
    };
  }

  function normalizeCall(packOrRequest, dataArgument) {
    if (isObject(packOrRequest) && isObject(packOrRequest.pack)) {
      var request = packOrRequest;
      var baseData = isObject(request.data)
        ? request.data
        : (isObject(request.context) ? request.context : {});
      var data = {};
      Object.keys(baseData).forEach(function (key) { data[key] = baseData[key]; });
      [
        'facts', 'evidence', 'supportingEvidence', 'selectedCoverage',
        'selectedCoverageId', 'coverageId', 'exclusions', 'potentialExclusions',
        'duties', 'authorizedHumanDecision'
      ].forEach(function (key) {
        if (hasOwn(request, key)) data[key] = request[key];
      });
      return { pack: request.pack, data: data };
    }
    return {
      pack: isObject(packOrRequest) ? packOrRequest : {},
      data: isObject(dataArgument) ? dataArgument : {}
    };
  }

  function authorityValues(value) {
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) {
      return value.map(asNonEmptyString).filter(Boolean).slice(0, 50);
    }
    if (isObject(value)) {
      return authorityValues(firstDefined(value.roles, value.authorities, value.role, value.id));
    }
    return [];
  }

  function validateHumanDecision(decision, pack, diagnostics) {
    if (decision === undefined || decision === null) return null;
    if (!isObject(decision)) {
      addDiagnostic(diagnostics, 'INVALID_HUMAN_DECISION',
        'The human decision must be an auditable object.', null);
      return null;
    }

    var requested = firstDefined(decision.decision, decision.result, decision.status);
    var finalStatus = null;
    if (requested === 'approved' || requested === STATUS.APPROVED) finalStatus = STATUS.APPROVED;
    if (requested === 'rejected' || requested === STATUS.REJECTED) finalStatus = STATUS.REJECTED;
    var userId = asNonEmptyString(firstDefined(decision.userId,
      isObject(decision.user) ? decision.user.id : undefined));

    if (decision.authorized !== true || !userId || !finalStatus) {
      addDiagnostic(diagnostics, 'UNAUTHORIZED_OR_INCOMPLETE_DECISION',
        'A final decision requires an authorized user, user identifier, and explicit decision.', null);
      return null;
    }

    var policy = isObject(pack.decisionPolicy) ? pack.decisionPolicy : {};
    var requiredAuthorities = authorityValues(firstDefined(
      policy.approvalAuthority,
      pack.approvalAuthority
    ));
    var suppliedAuthorities = authorityValues(firstDefined(
      decision.authorities,
      decision.authority,
      decision.role
    ));
    if (policy.enforceApprovalAuthority === true && requiredAuthorities.length &&
        !requiredAuthorities.some(function (required) {
          return suppliedAuthorities.indexOf(required) >= 0;
        })) {
      addDiagnostic(diagnostics, 'INSUFFICIENT_DECISION_AUTHORITY',
        'The authorized user does not have the configured approval authority.', null);
      return null;
    }

    return {
      status: finalStatus,
      userId: userId,
      authority: suppliedAuthorities,
      decidedAt: asNonEmptyString(decision.decidedAt),
      decisionId: asNonEmptyString(firstDefined(decision.decisionId, decision.auditId))
    };
  }

  function selectReportParagraph(pack, effectiveStatus) {
    var configured = firstDefined(pack.reportWording, pack.reportParagraph, pack.reportBindings);
    if (typeof configured === 'string') return configured;
    if (isObject(configured)) {
      var aliases = {};
      aliases[STATUS.POTENTIALLY_APPLICABLE] = ['potentiallyApplicable', 'potential', 'default'];
      aliases[STATUS.NOT_ESTABLISHED] = ['notEstablished', 'default'];
      aliases[STATUS.ADDITIONAL_EVIDENCE_REQUIRED] = ['additionalEvidence', 'default'];
      aliases[STATUS.POTENTIAL_EXCLUSION] = ['potentialExclusion', 'default'];
      aliases[STATUS.OUTSIDE_SELECTED_COVERAGE] = ['outsideCoverage', 'default'];
      aliases[STATUS.REQUIRES_SENIOR_REVIEW] = ['seniorReview', 'default'];
      aliases[STATUS.APPROVED] = ['approved', 'default'];
      aliases[STATUS.REJECTED] = ['rejected', 'default'];
      if (typeof configured[effectiveStatus] === 'string') return configured[effectiveStatus];
      var candidates = aliases[effectiveStatus] || ['default'];
      for (var index = 0; index < candidates.length; index += 1) {
        if (typeof configured[candidates[index]] === 'string') return configured[candidates[index]];
      }
    }
    return 'این ارزیابی مقدماتی است و تصمیم نهایی پوشش فقط توسط کاربر مجاز ثبت می‌شود.';
  }

  function isAllowedStatus(value) {
    return ALLOWED_STATUSES.indexOf(value) >= 0;
  }

  function evaluateCoverage(packOrRequest, dataArgument) {
    var normalized = normalizeCall(packOrRequest, dataArgument);
    var pack = normalized.pack;
    var data = normalized.data;
    var facts = isObject(data.facts) ? data.facts : data;
    var diagnostics = [];
    var packId = asNonEmptyString(firstDefined(pack.coverageId, pack.coverageRef, pack.id));
    var selectedValue = firstDefined(data.selectedCoverageId, data.selectedCoverage, data.coverageId);
    var selectedId = isObject(selectedValue)
      ? asNonEmptyString(firstDefined(selectedValue.id, selectedValue.coverageId))
      : asNonEmptyString(selectedValue);
    var selectionWasExplicit = selectedValue !== undefined && selectedValue !== null;
    if (!selectedId) selectedId = packId;

    var triggerRule = firstDefined(pack.coverageTrigger, pack.trigger, pack.triggerRule);
    if (triggerRule === undefined && Array.isArray(pack.triggerRules)) {
      triggerRule = { all: pack.triggerRules };
    }
    var trigger = evaluateRule(triggerRule, facts);
    Array.prototype.push.apply(diagnostics, trigger.diagnostics);
    if (triggerRule === undefined || triggerRule === null) {
      addDiagnostic(diagnostics, 'MISSING_COVERAGE_TRIGGER',
        'The coverage pack has no declarative trigger.', packId);
    }

    var evidence = evaluateEvidence(pack, data, facts, diagnostics);
    var exclusions = evaluateExclusions(pack, data, facts, diagnostics);
    var duties = evaluateDuties(pack, data, facts, evidence.index, diagnostics);
    var outsideSelectedCoverage = Boolean(
      selectionWasExplicit && packId && selectedId && selectedId !== packId
    );
    var matchedExclusion = exclusions.some(function (item) { return item.matched === true; });
    var unresolvedRequiredExclusion = exclusions.some(function (item) {
      return item.matched === null && item.requiresAssessment;
    });
    var failedDuty = duties.some(function (item) { return item.performed === false; });
    var policy = isObject(pack.decisionPolicy) ? pack.decisionPolicy : {};

    var systemStatus;
    if (outsideSelectedCoverage) {
      systemStatus = STATUS.OUTSIDE_SELECTED_COVERAGE;
    } else if (trigger.matched === false) {
      systemStatus = STATUS.NOT_ESTABLISHED;
    } else if (failedDuty || policy.requiresSeniorReview === true) {
      systemStatus = STATUS.REQUIRES_SENIOR_REVIEW;
    } else if (matchedExclusion) {
      systemStatus = STATUS.POTENTIAL_EXCLUSION;
    } else if (trigger.matched === null || evidence.missing.length || unresolvedRequiredExclusion) {
      systemStatus = STATUS.ADDITIONAL_EVIDENCE_REQUIRED;
    } else if (trigger.matched === true) {
      systemStatus = STATUS.POTENTIALLY_APPLICABLE;
    } else {
      systemStatus = STATUS.NOT_ESTABLISHED;
    }

    var humanDecision = validateHumanDecision(data.authorizedHumanDecision, pack, diagnostics);
    var effectiveStatus = humanDecision ? humanDecision.status : systemStatus;
    var finalApprovalStatus = humanDecision
      ? humanDecision.status
      : STATUS.REQUIRES_SENIOR_REVIEW;

    return {
      engineVersion: ENGINE_VERSION,
      selectedCoverage: {
        id: selectedId || null,
        title: asNonEmptyString(firstDefined(pack.titleFa, pack.persianTitle, pack.title, pack.name))
      },
      coverageDocumentVersion: safeScalar(firstDefined(
        pack.documentVersion,
        pack.conditionDocumentVersion,
        pack.version
      )),
      conditionDocumentId: asNonEmptyString(pack.conditionDocumentId),
      triggerFacts: trigger.facts,
      triggerMatched: trigger.matched,
      supportingEvidence: evidence.supporting,
      missingEvidence: evidence.missing,
      potentialExclusions: exclusions,
      deductibleRuleReference: deductibleReference(pack),
      duties: duties,
      systemAssessmentStatus: systemStatus,
      expertDecisionStatus: effectiveStatus,
      finalApprovalStatus: finalApprovalStatus,
      status: effectiveStatus,
      isFinal: Boolean(humanDecision),
      requiresAuthorizedHumanDecision: !humanDecision,
      authorizedHumanDecision: humanDecision,
      reportParagraph: selectReportParagraph(pack, effectiveStatus),
      diagnostics: diagnostics
    };
  }

  return Object.freeze({
    ENGINE_VERSION: ENGINE_VERSION,
    STATUS: STATUS,
    ALLOWED_STATUSES: ALLOWED_STATUSES,
    evaluateRule: evaluateRule,
    evaluateCoverage: evaluateCoverage,
    isAllowedStatus: isAllowedStatus
  });
}));
