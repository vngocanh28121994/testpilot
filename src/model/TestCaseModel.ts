/**
 * Test case model — items 32 + 33 (plan §24, §56).
 *
 * Lives between RequirementArtifact and the Gherkin generator:
 *   RequirementArtifact → TestCaseModel[] → Gherkin → Automation
 *
 * TestDataRef (item 33) keeps credentials and variable data out of
 * generated Gherkin — test cases reference data by key, never by value.
 */

import type { SourceReference } from './SourceReference.js';

// ── TestDataRef (item 33, plan §56) ──────────────────────────────────────────

export type TestDataType = 'static' | 'generated' | 'fixture' | 'secret' | 'environment';

export interface TestDataRef {
  id: string;
  type: TestDataType;
  /**
   * The parameter key used in the Gherkin template, e.g. "<amount>".
   * Actual values are resolved at runtime; never stored inline.
   */
  key: string;
  /** Visible hint for reviewers — never the real value. */
  maskedValue?: string;
  /** Concrete values for 'static' and 'generated' types. */
  values?: Array<string | number | boolean>;
  /** Description of how to obtain the value (for 'fixture' / 'environment'). */
  source?: string;
}

// ── TestStep ──────────────────────────────────────────────────────────────────

export type StepKeyword = 'given' | 'when' | 'then' | 'and' | 'but';

export interface TestStep {
  id: string;
  keyword: StepKeyword;
  /**
   * Step text using <param> placeholders for parameterised data.
   * E.g. "the transfer amount is <amount>"
   */
  text: string;
  /** Data references for placeholders in `text`. */
  dataRefs?: TestDataRef[];
}

// ── TestCaseModel (item 32, plan §24) ─────────────────────────────────────────

export type TestCasePriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TestCaseType =
  | 'positive'
  | 'negative'
  | 'boundary'
  | 'edge-case'
  | 'security'
  | 'performance';
export type AutomationStatus = 'planned' | 'implemented' | 'verified';

export interface TestCaseModel {
  id: string;
  /** Back-references to RequirementArtifact ids. */
  requirementIds: string[];
  /** Back-references to BusinessRule ids covered by this test case. */
  businessRuleIds?: string[];
  title: string;
  priority: TestCasePriority;
  type: TestCaseType;
  preconditions: string[];
  steps: TestStep[];
  expectedResults: string[];
  automationStatus: AutomationStatus;
  /** Cucumber/Gherkin tags for filtering (e.g. "@smoke", "@regression"). */
  tags?: string[];
  /** Where in the requirements this test case originates. */
  sourceRefs?: SourceReference[];
  /** All test data required by this test case. */
  testData?: TestDataRef[];
  /** Rationale for why this test case exists (for review). */
  rationale?: string;
}

// ── Test Design Quality Score (plan §55) ─────────────────────────────────────

export interface CoverageReport {
  /** Business rule ids covered by at least one test case. */
  coveredRuleIds: string[];
  /** Business rule ids with no covering test case. */
  uncoveredRuleIds: string[];
  /** 0..1 — fraction of rules covered. */
  rulesCoverage: number;

  positiveCount: number;
  negativeCount: number;
  boundaryCount: number;

  /** Test case ids that appear to duplicate another (same steps after normalisation). */
  duplicateIds: string[];

  /** 0..100 composite score. */
  score: number;
}

/**
 * Computes a test design quality score for a set of test cases against
 * the business rules they should cover (plan §55).
 */
export function computeCoverageReport(
  testCases: TestCaseModel[],
  allBusinessRuleIds: string[],
): CoverageReport {
  // Rule coverage
  const coveredSet = new Set<string>();
  for (const tc of testCases) {
    for (const rid of tc.businessRuleIds ?? []) coveredSet.add(rid);
  }
  const coveredRuleIds = allBusinessRuleIds.filter((id) => coveredSet.has(id));
  const uncoveredRuleIds = allBusinessRuleIds.filter((id) => !coveredSet.has(id));
  const rulesCoverage =
    allBusinessRuleIds.length === 0 ? 1 : coveredRuleIds.length / allBusinessRuleIds.length;

  // Type counts
  const positiveCount = testCases.filter((tc) => tc.type === 'positive').length;
  const negativeCount = testCases.filter((tc) => tc.type === 'negative').length;
  const boundaryCount = testCases.filter((tc) => tc.type === 'boundary').length;

  // Duplicate detection — normalise step text and compare
  const fingerprints = new Map<string, string>();
  const duplicateIds: string[] = [];
  for (const tc of testCases) {
    const fp = normaliseSteps(tc.steps);
    if (fingerprints.has(fp)) {
      duplicateIds.push(tc.id);
    } else {
      fingerprints.set(fp, tc.id);
    }
  }

  // Score (0..100)
  let score = 0;
  score += rulesCoverage * 40;                          // rule coverage: max 40
  score += positiveCount > 0 ? 15 : 0;                  // positive: 15
  score += negativeCount > 0 ? 20 : 0;                  // negative: 20
  score += boundaryCount > 0 ? 15 : 0;                  // boundary: 15
  score -= duplicateIds.length * 5;                      // duplicates: -5 each
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    coveredRuleIds,
    uncoveredRuleIds,
    rulesCoverage,
    positiveCount,
    negativeCount,
    boundaryCount,
    duplicateIds,
    score,
  };
}

function normaliseSteps(steps: TestStep[]): string {
  return steps
    .map((s) => `${s.keyword}:${s.text.toLowerCase().replace(/\s+/g, ' ').trim()}`)
    .join('|');
}
