import type { NormalizedFailure, FailureCategory } from '../execution/ExecutionTypes.js';
import type {
  DiagnosisResult,
  DiagnosisClassification,
  RecommendedAction,
  EvidenceItem,
} from './DiagnosisTypes.js';

/**
 * Deterministic rule engine — fires before AI (plan §68).
 *
 * Rules map NormalizedFailure fields to a DiagnosisResult without any LLM call.
 * Confidence is set based on how specific the rule match is; ambiguous categories
 * (e.g. UNKNOWN) get lower confidence so downstream stages can override.
 */
export class DiagnosisRuleEngine {
  diagnose(failure: NormalizedFailure): DiagnosisResult {
    const rule = RULES[failure.category] ?? RULES.UNKNOWN;
    return rule(failure);
  }
}

// ── rule map ──────────────────────────────────────────────────────────────────

type RuleFn = (f: NormalizedFailure) => DiagnosisResult;

const RULES: Record<FailureCategory, RuleFn> = {
  LOCATOR_FAILURE: locatorFailureRule,
  TIMEOUT: timeoutRule,
  NETWORK: networkRule,
  ASSERTION_MISMATCH: assertionMismatchRule,
  PRODUCT_DEFECT: productDefectRule,
  TEST_DATA: testDataRule,
  APP_CRASH: appCrashRule,
  ENVIRONMENT_UNAVAILABLE: environmentUnavailableRule,
  UNKNOWN: unknownRule,
};

// ── individual rules ──────────────────────────────────────────────────────────

function locatorFailureRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: 'category=LOCATOR_FAILURE → element lookup failed' },
    { type: 'signature', value: f.signature },
  ];

  if (f.stepId) {
    evidence.push({ type: 'locator', value: `failed at step ${f.stepId}` });
  }

  const confidence = f.confidence ?? 0.9;

  return build('LOCATOR_FAILURE', confidence, 'SELF_HEAL', evidence, []);
}

function timeoutRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: `category=TIMEOUT transient=${String(f.transient ?? false)}` },
    { type: 'signature', value: f.signature },
  ];

  if (f.transient) {
    evidence.push({ type: 'rule', value: 'marked transient — likely infrastructure lag' });
    return build('TIMEOUT', 0.7, 'RETRY', evidence, []);
  }

  // Non-transient timeout — more likely environment or a real product slowness
  const counter: EvidenceItem[] = [
    { type: 'rule', value: 'non-transient timeout may indicate product regression' },
  ];
  return build('ENVIRONMENT', 0.55, 'CHECK_ENVIRONMENT', evidence, counter);
}

function networkRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: 'category=NETWORK → external connectivity or API issue' },
    { type: 'signature', value: f.signature },
  ];
  return build('NETWORK', 0.8, 'CHECK_ENVIRONMENT', evidence, []);
}

function assertionMismatchRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'assertion', value: f.message },
    { type: 'rule', value: 'ASSERTION_MISMATCH — expected value differs from actual' },
    { type: 'signature', value: f.signature },
  ];
  // Assertion failures are typically product defects, but could be stale test data
  const counter: EvidenceItem[] = [
    { type: 'rule', value: 'could be stale test data — check TEST_DATA category' },
  ];
  return build('PRODUCT_DEFECT', 0.75, 'CREATE_DEFECT', evidence, counter);
}

function productDefectRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: 'category=PRODUCT_DEFECT — application behaved incorrectly' },
    { type: 'assertion', value: f.message },
    { type: 'signature', value: f.signature },
  ];
  return build('PRODUCT_DEFECT', f.confidence ?? 0.9, 'CREATE_DEFECT', evidence, []);
}

function testDataRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: 'category=TEST_DATA — prerequisite data missing or stale' },
    { type: 'signature', value: f.signature },
  ];
  return build('TEST_DATA', f.confidence ?? 0.8, 'FIX_TEST', evidence, []);
}

function appCrashRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'log', value: f.message },
    { type: 'rule', value: 'category=APP_CRASH — application process terminated unexpectedly' },
    { type: 'signature', value: f.signature },
  ];
  // Could be a product defect OR an automation defect (wrong action triggering crash)
  const counter: EvidenceItem[] = [
    { type: 'rule', value: 'may be AUTOMATION_DEFECT if crash is triggered by invalid input' },
  ];
  return build('PRODUCT_DEFECT', 0.7, 'CREATE_DEFECT', evidence, counter);
}

function environmentUnavailableRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: 'category=ENVIRONMENT_UNAVAILABLE — infrastructure not reachable' },
    { type: 'signature', value: f.signature },
  ];
  return build('ENVIRONMENT', 0.9, 'CHECK_ENVIRONMENT', evidence, []);
}

function unknownRule(f: NormalizedFailure): DiagnosisResult {
  const evidence: EvidenceItem[] = [
    { type: 'rule', value: 'category=UNKNOWN — no deterministic rule matched' },
    { type: 'signature', value: f.signature },
  ];
  return build('UNKNOWN', 0.3, 'INVESTIGATE', evidence, []);
}

// ── factory ───────────────────────────────────────────────────────────────────

function build(
  classification: DiagnosisClassification,
  confidence: number,
  recommendedAction: RecommendedAction,
  evidence: EvidenceItem[],
  counterEvidence: EvidenceItem[],
): DiagnosisResult {
  return { classification, confidence, evidence, counterEvidence, recommendedAction };
}
