/**
 * Shared types for P2 Automation Agent (plan §58–60, items 35–38).
 */

import type { ElementIntent } from '../discovery/ElementIntent.js';

// ── Step definition ───────────────────────────────────────────────────────────

/** A named, reusable automation step with its controlled-vocabulary patterns. */
export interface StepDefinition {
  id: string;
  /** Human-readable documentation shown in generation prompts. */
  doc: string;
  patterns: RegExp[];
  /** The Intent kind this step produces, e.g. "tap", "input". */
  intentKind: string;
}

// ── Step binding ──────────────────────────────────────────────────────────────

/** One Gherkin step text resolved to a concrete step definition. */
export interface StepBinding {
  /** Original step text from the Gherkin file. */
  stepText: string;
  /** STEP_RULES id that matched, or 'novel' when no match exists. */
  ruleId: string;
  /** True when this step reuses an existing vocabulary rule. */
  reused: boolean;
  /** ElementIntent extracted from this step, if applicable. */
  elementIntent?: ElementIntent;
}

// ── Generated file ────────────────────────────────────────────────────────────

export type FileAction = 'create' | 'modify';

export interface GeneratedFile {
  /** Repo-relative path. */
  path: string;
  content: string;
  action: FileAction;
  /** Short human-readable reason why this file was created/modified. */
  reason: string;
}

// ── Generated diff (item 38, plan §59) ───────────────────────────────────────

export interface FileDiff {
  path: string;
  action: FileAction;
  /** Unified diff representation (empty when action is 'create'). */
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface GeneratedDiff {
  scenarioId: string;
  files: FileDiff[];
  reason: string;
  /** Guardrail result — true when all files pass protected-path checks. */
  guardrailPassed: boolean;
  /** Paths that violated guardrails — must not be applied. */
  violatingPaths: string[];
  /** Validation summary populated after CompileGate runs. */
  validation?: ValidationSummary;
}

// ── Validation (item 37, plan §60) ───────────────────────────────────────────

export interface ValidationStage {
  name: 'format' | 'lint' | 'typecheck' | 'compile' | 'step-binding' | 'unit-tests';
  passed: boolean;
  /** Raw output from the subprocess or checker. */
  output: string;
  durationMs: number;
}

export interface ValidationSummary {
  compilePassed: boolean;
  lintPassed: boolean;
  typecheckPassed: boolean;
  stepBindingPassed: boolean;
  stages: ValidationStage[];
  /** True only when ALL stages that ran passed. */
  allPassed: boolean;
}

// ── Automation artifact (plan §58) ───────────────────────────────────────────

export interface AutomationArtifact {
  scenarioId: string;
  /** All files produced or modified by this implementation. */
  files: GeneratedFile[];
  /** One binding per Gherkin step in the scenario. */
  stepBindings: StepBinding[];
  /** All element intents referenced across the steps. */
  elementIntents: ElementIntent[];
  validation: ValidationSummary;
  /** The generated diff for human review. */
  diff: GeneratedDiff;
}

// ── Guardrail policy (plan §59) ───────────────────────────────────────────────

/** Paths the automation agent must never touch. */
export const PROTECTED_PATTERNS: RegExp[] = [
  /package\.json$/,
  /package-lock\.json$/,
  /\.github\//,
  /\.gitlab-ci/,
  /CI\//,
  /cd\//i,
  /Jenkinsfile/,
  /credentials?\.(json|ya?ml|env)$/i,
  /\.env$/,
  /aws-credentials/i,
  /tsconfig\.json$/,
  /eslint\.config/,
  /\.prettierrc/,
];

/** Returns true when the path is protected and must not be written. */
export function isProtectedPath(path: string, extra: RegExp[] = []): boolean {
  return [...PROTECTED_PATTERNS, ...extra].some((re) => re.test(path));
}

/** Convenience: a ValidationSummary with all stages passed (used when gate is skipped). */
export function emptyValidation(): ValidationSummary {
  return {
    compilePassed: true,
    lintPassed: true,
    typecheckPassed: true,
    stepBindingPassed: true,
    stages: [],
    allPassed: true,
  };
}
