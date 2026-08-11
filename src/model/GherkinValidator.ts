/**
 * Gherkin quality gate — item 34 (plan §57).
 *
 * Validates generated Gherkin before the automation implementation agent runs.
 * Three layers:
 *   1. Syntax       — parse via @cucumber/gherkin; hard fail on parse error.
 *   2. Semantic     — Given/When/Then ordering, result exists, no duplicate titles.
 *   3. Step reuse   — every step must match a STEP_RULES pattern (controlled vocabulary).
 *
 * Nothing runs on a device until all three layers pass.
 */

import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import type { Feature, Scenario, Step } from '@cucumber/messages';
import { STEP_RULES } from '../steps/vocabulary.js';

// ── result types ──────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  layer: 'syntax' | 'semantic' | 'step-reuse';
  message: string;
  scenarioTitle?: string;
  /** 1-based line number in the Gherkin source. */
  line?: number;
}

export interface GherkinValidationResult {
  /** True when there are no errors (warnings are allowed). */
  valid: boolean;
  issues: ValidationIssue[];
  /** Parsed scenario titles — present only when syntax was valid. */
  scenarioTitles?: string[];
  /** Total step count across all scenarios. */
  totalSteps?: number;
}

// ── main validator ────────────────────────────────────────────────────────────

/**
 * Validate a Gherkin feature string through all three layers.
 *
 * Returns immediately after syntax failure — semantic and step-reuse checks
 * require a valid AST.
 */
export function validateGherkin(
  source: string,
  uri = '<generated>',
): GherkinValidationResult {
  const issues: ValidationIssue[] = [];

  // ── Layer 1: Syntax ───────────────────────────────────────────────────────
  const parser = new Parser(
    new AstBuilder(IdGenerator.uuid()),
    new GherkinClassicTokenMatcher(),
  );

  let feature: Feature;
  try {
    const doc = parser.parse(source);
    if (!doc.feature) {
      issues.push({
        severity: 'error',
        layer: 'syntax',
        message: `${uri} contains no Feature block`,
      });
      return { valid: false, issues };
    }
    feature = doc.feature;
  } catch (err) {
    issues.push({
      severity: 'error',
      layer: 'syntax',
      message: `Syntax error: ${(err as Error).message}`,
    });
    return { valid: false, issues };
  }

  // ── Layer 2: Semantic ─────────────────────────────────────────────────────
  const scenarios = feature.children
    .map((c) => c.scenario)
    .filter((s): s is Scenario => s != null);

  if (scenarios.length === 0) {
    issues.push({
      severity: 'error',
      layer: 'semantic',
      message: 'Feature has no scenarios',
    });
  }

  // Duplicate scenario titles
  const seenTitles = new Map<string, number>();
  for (const scenario of scenarios) {
    const title = scenario.name.trim();
    const prev = seenTitles.get(title);
    if (prev !== undefined) {
      issues.push({
        severity: 'error',
        layer: 'semantic',
        scenarioTitle: title,
        message: `Duplicate scenario title "${title}"`,
      });
    } else {
      seenTitles.set(title, scenario.location.line);
    }
  }

  // Per-scenario semantic checks
  for (const scenario of scenarios) {
    validateScenarioSemantics(scenario, issues);
  }

  // ── Layer 3: Step reuse ───────────────────────────────────────────────────
  for (const scenario of scenarios) {
    for (const step of scenario.steps) {
      validateStepVocabulary(step, scenario.name, issues);
    }
  }

  const valid = !issues.some((i) => i.severity === 'error');
  const scenarioTitles = scenarios.map((s) => s.name);
  const totalSteps = scenarios.reduce((n, s) => n + s.steps.length, 0);

  return { valid, issues, scenarioTitles, totalSteps };
}

// ── semantic checks ───────────────────────────────────────────────────────────

const GIVEN_KEYWORDS = new Set(['given', 'cho trước', 'giả sử']);
const WHEN_KEYWORDS = new Set(['when', 'khi']);
const THEN_KEYWORDS = new Set(['then', 'thì', 'thì ra']);
const AND_BUT_KEYWORDS = new Set(['and', 'but', 'và', 'nhưng', '*']);

function classifyStep(step: Step): 'given' | 'when' | 'then' | 'and-but' | 'unknown' {
  const kw = step.keyword.trim().toLowerCase();
  if (GIVEN_KEYWORDS.has(kw)) return 'given';
  if (WHEN_KEYWORDS.has(kw)) return 'when';
  if (THEN_KEYWORDS.has(kw)) return 'then';
  if (AND_BUT_KEYWORDS.has(kw)) return 'and-but';
  return 'unknown';
}

function validateScenarioSemantics(scenario: Scenario, issues: ValidationIssue[]): void {
  const title = scenario.name;
  const steps = scenario.steps;

  if (steps.length === 0) {
    issues.push({
      severity: 'error',
      layer: 'semantic',
      scenarioTitle: title,
      message: `Scenario "${title}" has no steps`,
    });
    return;
  }

  // Resolve And/But to the preceding concrete keyword
  let lastConcrete: 'given' | 'when' | 'then' | null = null;
  const resolved: Array<'given' | 'when' | 'then'> = [];

  for (const step of steps) {
    const kind = classifyStep(step);
    if (kind === 'given' || kind === 'when' || kind === 'then') {
      lastConcrete = kind;
      resolved.push(kind);
    } else if (kind === 'and-but') {
      if (!lastConcrete) {
        issues.push({
          severity: 'error',
          layer: 'semantic',
          scenarioTitle: title,
          line: step.location.line,
          message: `"${step.keyword.trim()}" at line ${step.location.line} has no preceding Given/When/Then`,
        });
      } else {
        resolved.push(lastConcrete);
      }
    }
  }

  // Must end with Then
  if (resolved[resolved.length - 1] !== 'then') {
    issues.push({
      severity: 'error',
      layer: 'semantic',
      scenarioTitle: title,
      message: `Scenario "${title}" must end with a Then step (expected result)`,
    });
  }

  // When before Then
  const hasWhen = resolved.includes('when');
  if (!hasWhen) {
    issues.push({
      severity: 'warning',
      layer: 'semantic',
      scenarioTitle: title,
      message: `Scenario "${title}" has no When step — consider adding an action step`,
    });
  }

  // Invalid ordering: Given after When
  let inWhenOrThen = false;
  for (const k of resolved) {
    if (k === 'when' || k === 'then') inWhenOrThen = true;
    if (inWhenOrThen && k === 'given') {
      issues.push({
        severity: 'error',
        layer: 'semantic',
        scenarioTitle: title,
        message: `Scenario "${title}" has a Given step after When/Then — invalid ordering`,
      });
      break;
    }
  }
}

// ── step vocabulary check ─────────────────────────────────────────────────────

function validateStepVocabulary(
  step: Step,
  scenarioTitle: string,
  issues: ValidationIssue[],
): void {
  const text = step.text.trim();
  const matched = STEP_RULES.some((rule) =>
    rule.patterns.some((pattern) => pattern.test(text)),
  );

  if (!matched) {
    issues.push({
      severity: 'error',
      layer: 'step-reuse',
      scenarioTitle,
      line: step.location.line,
      message:
        `Step "${text}" at line ${step.location.line} does not match any controlled vocabulary pattern. ` +
        `Fix the wording or add a new STEP_RULE.`,
    });
  }
}

// ── convenience ───────────────────────────────────────────────────────────────

/** Returns a human-readable summary of validation issues. */
export function formatValidationIssues(result: GherkinValidationResult): string {
  if (result.valid && result.issues.length === 0) return 'Gherkin validation passed.';

  const lines: string[] = [
    result.valid ? 'Gherkin validation passed with warnings:' : 'Gherkin validation FAILED:',
  ];

  for (const issue of result.issues) {
    const loc = issue.line != null ? `:${issue.line}` : '';
    const ctx = issue.scenarioTitle ? ` [${issue.scenarioTitle}]` : '';
    lines.push(`  [${issue.severity.toUpperCase()}] (${issue.layer})${ctx}${loc} ${issue.message}`);
  }

  return lines.join('\n');
}
