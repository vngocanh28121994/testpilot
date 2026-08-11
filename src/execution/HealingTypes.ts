import type { FailureCategory } from './ExecutionTypes.js';

export type HealingMethod =
  | 'known-fallback'      // existing verified locator in RuntimeRegistry
  | 'runtime-observation' // found via deterministic matching on live UI
  | 'semantic-ai'         // found via semantic AI (future)
  | 'vision'              // found via vision model (future)
  | 'none';               // healing not attempted or not possible

/** One guard check in the anti-regression pipeline. */
export interface AntiRegressionCheck {
  name: string;
  passed: boolean;
  /** Human-readable explanation, populated only when passed=false. */
  detail?: string;
}

/**
 * Evidence-rich outcome of one healing attempt.
 *
 * `healed: true` means:
 *   - discovery found a candidate
 *   - anti-regression passed all checks
 *   - the locator was stored in RuntimeRegistry as 'healed'
 *
 * `retryPassed` is always false from the orchestrator — the caller
 * (executor) must re-run the step and set this field to the outcome.
 * Plan section 73: confidence AND verification AND retry pass → HEALING_SUCCESS.
 */
export interface HealingResult {
  healed: boolean;
  /** Locator that was originally failing. */
  oldLocator?: { strategy: string; value: string };
  /** Locator the discovery pipeline found. */
  newLocator?: { strategy: string; value: string };
  /** 0..100 confidence from the discovery matcher (0 when healed=false). */
  confidence: number;
  method: HealingMethod;
  evidence: string[];
  /** Did the step actually pass after the healed locator was used? Set by executor. */
  retryPassed: boolean;
  /** Whether the anti-regression guard accepted the new locator. */
  antiRegressionPassed: boolean;
  antiRegressionChecks?: AntiRegressionCheck[];
  /** Populated when healed=false to explain why. */
  rejectionReason?: string;
}

/**
 * Per-failure-category policy decision.
 * Drives what the HealingOrchestrator is allowed to do.
 */
export interface HealingDecision {
  /** Whether the pipeline should attempt live UI observation + matching. */
  shouldDiscover: boolean;
  /** Whether AI disambiguation is permitted (future; wires to SemanticDiscovery). */
  shouldTryAi: boolean;
  /** Whether the orchestrator may write a healed locator back to the registry. */
  canAutoHeal: boolean;
  /** Maximum total step attempts (including the original failed one). */
  maxAttempts: number;
  reason: string;
}

/** Exposed so callers can build HealingDecision from a FailureCategory without importing the class. */
export type { FailureCategory };
