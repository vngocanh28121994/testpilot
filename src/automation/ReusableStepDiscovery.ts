/**
 * Reusable step discovery — item 35 (plan §58).
 *
 * For each test step in a TestCaseModel, finds whether an existing STEP_RULE
 * pattern already covers it. Reusing an existing rule is always preferred over
 * generating a new step definition.
 *
 * Priority order (plan §58):
 *   existing reusable step > existing helper > new step > new helper
 */

import type { TestStep } from '../model/TestCaseModel.js';
import type { StepDefinition, StepBinding } from './AutomationTypes.js';
import { STEP_RULES } from '../steps/vocabulary.js';

// ── result types ──────────────────────────────────────────────────────────────

export interface StepMatch {
  step: TestStep;
  /** The matched StepDefinition id. */
  ruleId: string;
  /** The pattern that matched. */
  pattern: RegExp;
  /** Regex match array — contains captured groups (element labels, texts, etc.). */
  match: RegExpMatchArray;
}

export interface NovelStep {
  step: TestStep;
  /** Suggested Gherkin wording that might fit the vocabulary — heuristic only. */
  suggestedWording?: string;
}

export interface DiscoveryResult {
  /** Steps that matched an existing STEP_RULE pattern. */
  matched: StepMatch[];
  /** Steps that matched no existing pattern and need a new rule or rewording. */
  novel: NovelStep[];
  /** 0..1 — fraction of steps that could be reused. */
  reuseRate: number;
}

// ── main class ────────────────────────────────────────────────────────────────

/**
 * Matches TestCaseModel steps against the controlled vocabulary.
 *
 * Pass `extraDefinitions` to also check project-specific step rules beyond
 * the default STEP_RULES vocabulary.
 */
export class ReusableStepDiscovery {
  private readonly definitions: StepDefinition[];

  constructor(extraDefinitions: StepDefinition[] = []) {
    // Convert STEP_RULES to StepDefinition shape
    const vocab: StepDefinition[] = STEP_RULES.map((r) => ({
      id: r.id,
      doc: r.doc,
      patterns: r.patterns,
      intentKind: r.id,
    }));
    this.definitions = [...vocab, ...extraDefinitions];
  }

  /**
   * Scan a list of test steps and classify each as reusable or novel.
   */
  discover(steps: TestStep[]): DiscoveryResult {
    const matched: StepMatch[] = [];
    const novel: NovelStep[] = [];

    for (const step of steps) {
      const result = this.matchStep(step);
      if (result) {
        matched.push(result);
      } else {
        novel.push({
          step,
          suggestedWording: this.suggestWording(step),
        });
      }
    }

    const total = steps.length;
    const reuseRate = total === 0 ? 1 : matched.length / total;

    return { matched, novel, reuseRate };
  }

  /**
   * Convert matched steps to StepBindings for the AutomationArtifact.
   * Novel steps produce a binding with ruleId='novel' and reused=false.
   */
  toBindings(steps: TestStep[]): StepBinding[] {
    const { matched, novel } = this.discover(steps);

    const matchedBindings: StepBinding[] = matched.map((m) => ({
      stepText: m.step.text,
      ruleId: m.ruleId,
      reused: true,
    }));

    const novelBindings: StepBinding[] = novel.map((n) => ({
      stepText: n.step.text,
      ruleId: 'novel',
      reused: false,
    }));

    // Preserve original step order
    return steps.map(
      (step) =>
        matchedBindings.find((b) => b.stepText === step.text) ??
        novelBindings.find((b) => b.stepText === step.text) ?? {
          stepText: step.text,
          ruleId: 'novel',
          reused: false,
        },
    );
  }

  /** Returns the documentation strings for all registered step definitions. */
  getVocabularyDocs(): string[] {
    return this.definitions.map((d) => d.doc);
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private matchStep(step: TestStep): StepMatch | null {
    const text = step.text.trim();
    for (const def of this.definitions) {
      for (const pattern of def.patterns) {
        const m = text.match(pattern);
        if (m) {
          return { step, ruleId: def.id, pattern, match: m };
        }
      }
    }
    return null;
  }

  /**
   * Heuristic: suggest a vocabulary-compatible wording for novel steps.
   *
   * Looks for common action words in the step text and maps them to existing
   * rule docs. This is a best-effort hint — the implementation agent or a human
   * must verify it.
   */
  private suggestWording(step: TestStep): string | undefined {
    const lower = step.text.toLowerCase();

    if (/tap|click|press|bấm|nhấn/.test(lower)) {
      return 'I tap "<element>"';
    }
    if (/type|enter|input|fill|nhập/.test(lower)) {
      return 'I type "<text>" into "<element>"';
    }
    if (/scroll/.test(lower)) {
      return 'I scroll to "<element>"';
    }
    if (/swipe/.test(lower)) {
      return 'I swipe <direction>';
    }
    if (/see|visible|hiển thị|assert|verify/.test(lower)) {
      return 'I see "<element>"';
    }
    if (/not.*see|invisible|không.*thấy/.test(lower)) {
      return '"<element>" is not visible';
    }
    if (/open|launch|mở/.test(lower)) {
      return 'I open the app';
    }
    if (/wait/.test(lower)) {
      return 'I wait for "<element>"';
    }
    return undefined;
  }
}
