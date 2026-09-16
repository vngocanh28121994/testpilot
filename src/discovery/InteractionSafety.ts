/**
 * Interaction safety gate — G06 (review v5 + v6 §13-16).
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
 *   UNSAFE   — one or more hard safety checks fail (value is known-bad)
 *   AMBIGUOUS— retained for API compatibility; candidate uniqueness is decided
 *              by AmbiguityPolicy before this actionability check.
 *   UNKNOWN  — retained for API compatibility; missing Appium metadata does not
 *              block execution in the configured test environment.
 */

import type { ActionKind, ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';
import { textMatch } from './ConfidenceScorer.js';

export type InteractionSafety = 'SAFE' | 'UNSAFE' | 'AMBIGUOUS' | 'UNKNOWN';

export interface SafetyChecks {
  /** Element exists in the current observation. */
  exists: boolean;
  /** Element is visible on screen. */
  visible: boolean;
  /** Element is not disabled (undefined when metadata is missing). */
  enabled: boolean | undefined;
  /** Element is interactive (undefined when metadata is missing). */
  interactive: boolean | undefined;
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
  opts: { allowExactTextProxy?: boolean } = {},
): SafetyCheckResult {
  const evidence: string[] = [];
  const visible     = candidate.visible;
  const enabledRaw  = candidate.enabled;
  const interactRaw = candidate.interactive;
  const unique      = isUnique(candidate, allElements);

  // Hard actionability failures only. Business labels such as "Chuyển tiền"
  // or "Xoá" do not change the policy: these runs use isolated test accounts.
  // Missing metadata is not evidence of a disabled control; the real driver
  // action and its postcondition remain authoritative.
  if (!visible) evidence.push('element is not visible on screen');
  if (enabledRaw === false && actionRequiresEnabled(intent.action)) {
    evidence.push(`element is disabled but action "${intent.action}" requires enabled`);
  }
  const exactTextProxy = opts.allowExactTextProxy === true
    && intent.action === 'tap'
    && visible
    && unique
    && hasExactSemanticName(intent, candidate);
  if (
    interactRaw === false &&
    actionRequiresInteractive(intent.action) &&
    !exactTextProxy
  ) {
    evidence.push(`element is not interactive but action "${intent.action}" requires it`);
  }

  const checks: SafetyChecks = {
    exists: true,
    visible,
    enabled: enabledRaw,
    interactive: interactRaw,
    unique,
  };

  if (evidence.length > 0) {
    return { safety: 'UNSAFE', reason: evidence[0]!, checks, evidence };
  }

  if (exactTextProxy) {
    return {
      safety: 'SAFE',
      reason: 'Exact unique visible text may proxy its clickable parent; outcome verification required',
      checks,
      evidence: ['interactive=false is treated as leaf-node metadata, not proof that its parent cannot be tapped'],
    };
  }

  return { safety: 'SAFE', reason: 'All safety checks passed', checks, evidence: [] };
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
  const others = all.filter(
    (e) =>
      e.id !== candidate.id &&
      // Something off-screen is not a thing the step could have meant, and not
      // a thing a tap could land on by mistake. Counting hidden twins made a
      // form with a collapsed panel permanently ambiguous.
      e.visible !== false &&
      signature(e) === sig,
  );
  return others.length === 0;
}

/**
 * What makes two elements indistinguishable to a person reading the screen.
 *
 * Placeholder belongs here. Without it every empty text field on a form shares
 * one signature — role alone, since an input has no text and no accessibility
 * label — so "Nhập mã" and "KL đặt" collided and discovery declared the whole
 * form ambiguous. That is the opposite of what the guard is for: those two are
 * the easiest pair on the screen for a person to tell apart.
 */
function signature(e: ObservedElement): string | null {
  const parts = [e.role, e.text, e.accessibilityLabel, e.placeholder].filter(
    (v): v is string => v != null && v.trim() !== '',
  );
  return parts.length > 0 ? parts.map((v) => v.toLowerCase()).join('|') : null;
}

function actionRequiresEnabled(action: ActionKind): boolean {
  return ['tap', 'drag', 'input', 'select', 'check', 'uncheck'].includes(action);
}

function actionRequiresInteractive(action: ActionKind): boolean {
  return ['tap', 'drag', 'input', 'select', 'check', 'uncheck', 'scroll'].includes(action);
}

function hasExactSemanticName(intent: ElementIntent, candidate: ObservedElement): boolean {
  const wanted = intent.text ?? intent.label;
  if (!wanted) return false;
  return [candidate.accessibilityLabel, candidate.text, candidate.placeholder]
    .some((value) => value != null && textMatch(value, wanted) === 'exact');
}
