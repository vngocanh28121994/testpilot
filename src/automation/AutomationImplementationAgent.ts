/**
 * Automation Implementation Agent — item 36 (plan §58).
 *
 * Converts a TestCaseModel into a runnable AutomationArtifact:
 *   1. Reusable step discovery — bind existing STEP_RULES patterns first
 *   2. Novel step generation   — AI fills gaps (via pluggable LLM provider)
 *   3. Gherkin file generation — writes the .feature file content
 *   4. ElementIntent extraction — derives intents from matched step captures
 *   5. Diff + guardrail check  — wraps all changes in a GeneratedDiff
 *   6. Compile gate            — static validation before any device runs
 *
 * Priority rule (plan §58): existing reusable step > new step.
 * The agent must never create a duplicate step definition.
 */

import type { TestCaseModel, TestStep } from '../model/TestCaseModel.js';
import type { StepDefinition, AutomationArtifact, GeneratedFile, StepBinding } from './AutomationTypes.js';
import type { ElementIntent, ActionKind } from '../discovery/ElementIntent.js';
import { ReusableStepDiscovery } from './ReusableStepDiscovery.js';
import { CompileGate, type CompileGateOptions } from './CompileGate.js';
import { buildDiff, attachValidation } from './GeneratedDiff.js';
import { emptyValidation } from './AutomationTypes.js';

// ── AI provider interface ─────────────────────────────────────────────────────

export interface AutomationLlmProvider {
  /**
   * Given a novel (unmatched) step and the current vocabulary, generate a
   * Gherkin step text that fits the controlled vocabulary, or propose a new
   * STEP_RULE pattern.
   */
  suggestStepWording(
    step: TestStep,
    vocabularyDocs: string[],
  ): Promise<{ rewording?: string; newRuleProposal?: string }>;
}

// ── options ───────────────────────────────────────────────────────────────────

export interface ImplementationOptions {
  /** Output directory for generated feature files (default: 'features'). */
  featuresDir?: string;
  /** Skip the CompileGate run (faster local iteration). */
  skipValidation?: boolean;
  compileGateOptions?: CompileGateOptions;
  /** Extra protected path patterns beyond the defaults. */
  extraProtectedPatterns?: RegExp[];
  llmProvider?: AutomationLlmProvider;
}

// ── agent ─────────────────────────────────────────────────────────────────────

export class AutomationImplementationAgent {
  private readonly stepDiscovery: ReusableStepDiscovery;

  constructor(extraDefinitions: StepDefinition[] = []) {
    this.stepDiscovery = new ReusableStepDiscovery(extraDefinitions);
  }

  async implement(
    testCase: TestCaseModel,
    opts: ImplementationOptions = {},
  ): Promise<AutomationArtifact> {
    const featuresDir = opts.featuresDir ?? 'features';

    // ── 1. Reusable step discovery ────────────────────────────────────────────
    const { matched, novel } = this.stepDiscovery.discover(testCase.steps);
    const bindings = this.stepDiscovery.toBindings(testCase.steps);

    // ── 2. Novel step handling via AI (if provider available) ─────────────────
    const resolvedBindings = await this.resolveNovelSteps(
      bindings,
      testCase.steps,
      novel.map((n) => n.step),
      opts.llmProvider,
    );

    // ── 3. Gherkin feature file generation ───────────────────────────────────
    const featureContent = buildFeatureFile(testCase, resolvedBindings);
    const featurePath = `${featuresDir}/${toSlug(testCase.id)}.feature`;

    const files: GeneratedFile[] = [
      {
        path: featurePath,
        content: featureContent,
        action: 'create',
        reason: `Gherkin feature for test case "${testCase.title}"`,
      },
    ];

    // ── 4. ElementIntent extraction ───────────────────────────────────────────
    const elementIntents = extractElementIntents(testCase, resolvedBindings);

    // ── 5. Diff + guardrail ───────────────────────────────────────────────────
    const diff = await buildDiff(
      testCase.id,
      files,
      `Implement test case "${testCase.title}" (${testCase.type}, ${testCase.priority})`,
      opts.extraProtectedPatterns,
    );

    // ── 6. Compile gate ───────────────────────────────────────────────────────
    let validation = emptyValidation();

    if (!opts.skipValidation) {
      const gate = new CompileGate(opts.compileGateOptions);
      validation = await gate.run({ source: featureContent, uri: featurePath });
    }

    const finalDiff = attachValidation(diff, validation);

    return {
      scenarioId: testCase.id,
      files,
      stepBindings: resolvedBindings,
      elementIntents,
      validation,
      diff: finalDiff,
    };
  }

  // ── novel step resolution ─────────────────────────────────────────────────

  private async resolveNovelSteps(
    bindings: StepBinding[],
    allSteps: TestStep[],
    novelSteps: TestStep[],
    llmProvider?: AutomationLlmProvider,
  ): Promise<StepBinding[]> {
    if (novelSteps.length === 0 || !llmProvider) return bindings;

    const vocabDocs = this.stepDiscovery.getVocabularyDocs();
    const resolved = [...bindings];

    for (const novelStep of novelSteps) {
      const response = await llmProvider.suggestStepWording(novelStep, vocabDocs);

      const idx = resolved.findIndex((b) => b.stepText === novelStep.text);
      if (idx === -1) continue;

      if (response.rewording) {
        // LLM found a vocabulary-compatible rewording — try to match it
        const rewoundStep: TestStep = { ...novelStep, text: response.rewording };
        const discovery = this.stepDiscovery.discover([rewoundStep]);
        if (discovery.matched.length > 0) {
          resolved[idx] = {
            stepText: response.rewording,
            ruleId: discovery.matched[0]!.ruleId,
            reused: true,
          };
          continue;
        }
      }

      // Keep as novel with proposal attached
      resolved[idx] = {
        ...resolved[idx]!,
        ruleId: response.newRuleProposal ? `proposed:${response.newRuleProposal}` : 'novel',
        reused: false,
      };
    }

    return resolved;
  }
}

// ── Gherkin generation ────────────────────────────────────────────────────────

function buildFeatureFile(testCase: TestCaseModel, bindings: StepBinding[]): string {
  const lines: string[] = [];

  // Tags
  const tags = [
    ...(testCase.tags ?? []),
    `@${testCase.priority.toLowerCase()}`,
    `@${testCase.type}`,
  ].join(' ');

  lines.push(`Feature: ${testCase.title}`);
  lines.push('');

  if (testCase.preconditions.length > 0) {
    lines.push('  Background:');
    for (const pre of testCase.preconditions) {
      lines.push(`    Given ${pre}`);
    }
    lines.push('');
  }

  lines.push(`  ${tags}`);
  lines.push(`  Scenario: ${testCase.title}`);

  for (const step of testCase.steps) {
    const binding = bindings.find((b) => b.stepText === step.text);
    const text = binding?.stepText ?? step.text;
    const kw = capitalise(step.keyword === 'and' ? 'And' : step.keyword);
    lines.push(`    ${kw} ${text}`);
  }

  if (testCase.expectedResults.length > 0) {
    for (const result of testCase.expectedResults) {
      lines.push(`    Then ${result}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── ElementIntent extraction ──────────────────────────────────────────────────

/**
 * Derives ElementIntents for elements referenced in test case steps.
 * Each unique element label becomes one intent.
 */
function extractElementIntents(
  testCase: TestCaseModel,
  bindings: StepBinding[],
): ElementIntent[] {
  const seen = new Set<string>();
  const intents: ElementIntent[] = [];

  for (const step of testCase.steps) {
    // Extract quoted labels from step text — elements are always in double quotes
    const quoted = [...step.text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

    for (const label of quoted) {
      if (seen.has(label)) continue;
      seen.add(label);

      const action = inferAction(step, bindings);
      intents.push({
        id: toElementId(testCase.id, label),
        label,
        screen: testCase.id,
        action,
        source: {
          testCaseId: testCase.id,
          stepId: step.id,
        },
      });
    }
  }

  return intents;
}

function inferAction(step: TestStep, bindings: StepBinding[]): ActionKind {
  const binding = bindings.find((b) => b.stepText === step.text);
  const ruleId = binding?.ruleId ?? '';

  const map: Record<string, ActionKind> = {
    tap: 'tap',
    input: 'input',
    clear: 'input',
    select: 'select',
    scroll: 'scroll',
    swipe: 'swipe',
    assertVisible: 'assert-visible',
    assertNotVisible: 'assert-visible',
    assertText: 'assert-text',
    assertEnabled: 'assert-enabled',
    assertDisabled: 'assert-disabled',
    waitFor: 'assert-visible',
    longPress: 'tap',
    check: 'check',
    uncheck: 'uncheck',
  };

  return map[ruleId] ?? 'assert-visible';
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toSlug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toElementId(testCaseId: string, label: string): string {
  const screen = testCaseId.split('-')[0] ?? testCaseId;
  return `${screen}.${label.replace(/\s+/g, '_').toLowerCase()}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
