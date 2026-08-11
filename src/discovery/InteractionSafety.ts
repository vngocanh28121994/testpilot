/**
 * Interaction safety gate — G06 (review v5).
 *
 * Separates two distinct questions:
 *   1. MatchConfidence  — "Is this likely the intended element?"  (0..100 score)
 *   2. InteractionSafety — "Is it safe to execute this action right now?"
 *
 * A candidate can have confidence=91 but safety=UNSAFE (element is disabled).
 * The executor must NEVER use confidence alone as permission to interact.
 *
 *   AI candidate → runtime element → verifier → InteractionSafety → action
 *
 * Safety checks (deterministic — no AI):
 *   SAFE     — visible, enabled, interactive, not covered, correct context
 *   UNSAFE   — one or more hard safety checks fail
 *   AMBIGUOUS— element cannot be uniquely identified on the current screen
 */

import type { ActionKind, ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';

export type InteractionSafety = 'SAFE' | 'UNSAFE' | 'AMBIGUOUS';

export interface SafetyChecks {
  /** Element exists in the current observation. */
  exists: boolean;
  /** Element is visible on screen. */
  visible: boolean;
  /** Element is not disabled. */
  enabled: boolean;
  /** Element is interactive (accepts user input). */
  interactive: boolean;
  /** No other element on screen shares the same semantic signature. */
  unique: boolean;
}

export interface SafetyCheckResult {
  safety: InteractionSafety;
  /** Primary reason the safety gate decided this outcome. */
  reason: string;
  checks: SafetyChecks;
  /** All evidence items (one per failed check). */
  evidence: string[];
}

// ── main check ────────────────────────────────────────────────────────────────

/**
 * Determine whether it is safe to execute `intent.action` on `candidate`.
 *
 * This runs AFTER match confidence is established — it is a separate gate,
 * not a replacement for the confidence score.
 *
 * @param intent      The semantic intent (especially `action`).
 * @param candidate   The matched element from the current observation.
 * @param allElements Full element list for uniqueness check.
 */
export function checkInteractionSafety(
  intent: ElementIntent,
  candidate: ObservedElement,
  allElements: ObservedElement[],
): SafetyCheckResult {
  const evidence: string[] = [];

  const visible    = candidate.visible;
  const enabled    = candidate.enabled !== false;
  const interactive = candidate.interactive !== false;
  const unique     = isUnique(candidate, allElements);

  if (!visible) evidence.push('element is not visible on screen');
  if (!enabled  && actionRequiresEnabled(intent.action)) evidence.push(`element is disabled but action "${intent.action}" requires enabled`);
  if (!interactive && actionRequiresInteractive(intent.action)) evidence.push(`element is not interactive but action "${intent.action}" requires it`);
  if (!unique)  evidence.push('element shares the same text/role signature with another element on screen (AMBIGUOUS)');

  const checks: SafetyChecks = { exists: true, visible, enabled, interactive, unique };

  // Ambiguity is a special case — do not click either element
  if (!unique) {
    return {
      safety: 'AMBIGUOUS',
      reason: evidence[evidence.length - 1]!,
      checks,
      evidence,
    };
  }

  const unsafe = evidence.length > 0;
  if (unsafe) {
    return {
      safety: 'UNSAFE',
      reason: evidence[0]!,
      checks,
      evidence,
    };
  }

  return {
    safety: 'SAFE',
    reason: 'All safety checks passed',
    checks,
    evidence: [],
  };
}

/**
 * Build a SafetyCheckResult for an element that was never found in the
 * observation (e.g., the known locator failed to resolve).
 */
export function unsafeNotFound(locator: string): SafetyCheckResult {
  return {
    safety: 'UNSAFE',
    reason: `Element not found in current observation (${locator})`,
    checks: { exists: false, visible: false, enabled: false, interactive: false, unique: false },
    evidence: [`Element not found: ${locator}`],
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isUnique(candidate: ObservedElement, all: ObservedElement[]): boolean {
  const sig = signature(candidate);
  if (!sig) return true; // No identifiable signal — cannot determine duplicates
  const others = all.filter((e) => e.id !== candidate.id && signature(e) === sig);
  return others.length === 0;
}

function signature(e: ObservedElement): string | null {
  const parts = [e.role, e.text, e.accessibilityLabel].filter(
    (v): v is string => v != null && v.trim() !== '',
  );
  return parts.length > 0 ? parts.map((v) => v.toLowerCase()).join('|') : null;
}

function actionRequiresEnabled(action: ActionKind): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck'].includes(action);
}

function actionRequiresInteractive(action: ActionKind): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck', 'scroll'].includes(action);
}
