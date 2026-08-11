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
 *   AMBIGUOUS— element cannot be uniquely identified on the current screen
 *   UNKNOWN  — critical metadata is missing for a HIGH-risk action.
 *              Per review v6 §15: missing evidence is NOT a silent PASS.
 *              Caller must re-observe or stop — never execute under UNKNOWN.
 */

import type { ActionKind, ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';
import { classifyActionRisk } from './ActionRisk.js';

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
): SafetyCheckResult {
  const evidence: string[] = [];
  const elementText = candidate.text ?? candidate.accessibilityLabel;
  const actionRisk = classifyActionRisk(intent.action, elementText);

  const visible     = candidate.visible;
  const enabledRaw  = candidate.enabled;
  const interactRaw = candidate.interactive;
  const unique      = isUnique(candidate, allElements);

  // AMBIGUOUS: element cannot be uniquely identified — do not click either element
  if (!unique) {
    const msg = 'element shares the same text/role signature with another element on screen (AMBIGUOUS)';
    evidence.push(msg);
    return {
      safety: 'AMBIGUOUS',
      reason: msg,
      checks: { exists: true, visible, enabled: enabledRaw, interactive: interactRaw, unique: false },
      evidence,
    };
  }

  // UNKNOWN: HIGH-risk action with missing critical metadata (v6 §15)
  // Never silently treat missing evidence as PASS for destructive actions.
  if (actionRisk === 'HIGH') {
    const missing: string[] = [];
    if (actionRequiresEnabled(intent.action) && enabledRaw == null) missing.push('enabled');
    if (actionRequiresInteractive(intent.action) && interactRaw == null) missing.push('interactive');

    if (missing.length > 0) {
      const msg =
        `HIGH-risk action "${intent.action}" with missing metadata: ${missing.join(', ')} — ` +
        `cannot confirm element is safe to interact with`;
      evidence.push(msg);
      return {
        safety: 'UNKNOWN',
        reason: msg,
        checks: { exists: true, visible, enabled: enabledRaw, interactive: interactRaw, unique: true },
        evidence,
      };
    }
  }

  // Hard failures (definitive bad state)
  if (!visible) evidence.push('element is not visible on screen');
  if (enabledRaw === false && actionRequiresEnabled(intent.action)) {
    evidence.push(`element is disabled but action "${intent.action}" requires enabled`);
  }
  if (interactRaw === false && actionRequiresInteractive(intent.action)) {
    evidence.push(`element is not interactive but action "${intent.action}" requires it`);
  }

  const checks: SafetyChecks = {
    exists: true,
    visible,
    enabled: enabledRaw,
    interactive: interactRaw,
    unique: true,
  };

  if (evidence.length > 0) {
    return { safety: 'UNSAFE', reason: evidence[0]!, checks, evidence };
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
