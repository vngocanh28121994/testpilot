/**
 * Verifies that a discovered candidate is safe to interact with before any
 * driver action is called.
 *
 * Verification rules are action-dependent:
 *   tap / input / select   → needs visible + enabled + interactive
 *   assert-disabled        → explicitly requires enabled=false
 *   assert-visible         → only needs visible=true
 *
 * Nothing is ever tapped/clicked when confidence is low or verification fails.
 */

import type { ActionKind, ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';

export interface VerificationChecks {
  exists: boolean;
  visible: boolean;
  enabled?: boolean;
  interactive?: boolean;
  roleMatch?: boolean;
  labelMatch?: boolean;
  screenMatch?: boolean;
  uniqueness?: boolean;
  contextMatch?: boolean;
}

export interface ElementVerification {
  passed: boolean;
  /** 0..100 — weighted completeness of the checks that were possible. */
  score: number;
  checks: VerificationChecks;
  evidence: string[];
}

export interface ElementVerifier {
  verify(
    intent: ElementIntent,
    candidate: ObservedElement,
    allElements?: ObservedElement[],
  ): ElementVerification;
}

export class StandardElementVerifier implements ElementVerifier {
  verify(
    intent: ElementIntent,
    candidate: ObservedElement,
    allElements: ObservedElement[] = [],
  ): ElementVerification {
    const checks: VerificationChecks = { exists: true, visible: candidate.visible };
    const evidence: string[] = [];

    if (!candidate.visible) {
      evidence.push(`element is not visible (id=${candidate.id})`);
    }

    // ── action-specific checks ────────────────────────────────────────────────

    if (actionRequiresEnabled(intent.action)) {
      checks.enabled = candidate.enabled !== false;
      if (candidate.enabled === false) {
        evidence.push(
          `element is disabled but action "${intent.action}" requires enabled`,
        );
      }
    }

    if (intent.action === 'assert-disabled') {
      checks.enabled = candidate.enabled === false;
      if (candidate.enabled !== false) {
        evidence.push('element is enabled but action "assert-disabled" requires disabled');
      }
    }

    if (actionRequiresInteractive(intent.action)) {
      checks.interactive = candidate.interactive !== false;
      if (candidate.interactive === false) {
        evidence.push('element is not interactive');
      }
    }

    // ── semantic checks ───────────────────────────────────────────────────────

    if (intent.semanticRole != null && candidate.role != null) {
      checks.roleMatch = norm(candidate.role) === norm(intent.semanticRole);
      if (!checks.roleMatch) {
        evidence.push(
          `role mismatch: expected "${intent.semanticRole}", found "${candidate.role}"`,
        );
      }
    }

    if (intent.label != null) {
      const candidateText =
        candidate.accessibilityLabel ?? candidate.text ?? candidate.placeholder ?? '';
      checks.labelMatch = norm(candidateText).includes(norm(intent.label));
      if (!checks.labelMatch) {
        evidence.push(
          `label mismatch: expected "${intent.label}", element has "${candidateText || '(empty)'}"`,
        );
      }
    }

    // ── uniqueness check ──────────────────────────────────────────────────────

    if (allElements.length > 1) {
      const sig = elementSignature(candidate);
      const duplicates = allElements.filter(
        (e) => e.id !== candidate.id && elementSignature(e) === sig,
      ).length;
      checks.uniqueness = duplicates === 0;
      if (!checks.uniqueness) {
        evidence.push(
          `${duplicates} other element(s) share the same text/role signature`,
        );
      }
    }

    const passed = computePassed(checks, intent.action);
    const score = computeScore(checks);

    return { passed, score, checks, evidence };
  }
}

function computePassed(checks: VerificationChecks, action: ActionKind): boolean {
  if (!checks.exists) return false;
  // assert-disabled does not need visible
  if (!checks.visible && action !== 'assert-disabled') return false;
  if (actionRequiresEnabled(action) && checks.enabled === false) return false;
  // checks.enabled stores (candidate.enabled === false), i.e. "is disabled?"
  // So !checks.enabled means the element is NOT actually disabled → fail.
  if (action === 'assert-disabled' && !checks.enabled) return false;
  if (actionRequiresInteractive(action) && checks.interactive === false) return false;
  return true;
}

function computeScore(checks: VerificationChecks): number {
  let score = 0;
  let total = 0;

  const add = (value: boolean | undefined, weight: number) => {
    if (value !== undefined) {
      total += weight;
      if (value) score += weight;
    }
  };

  add(checks.exists, 30);
  add(checks.visible, 25);
  add(checks.enabled, 15);
  add(checks.interactive, 15);
  add(checks.roleMatch, 10);
  add(checks.labelMatch, 5);

  return total > 0 ? Math.round((score / total) * 100) : 0;
}

function elementSignature(e: ObservedElement): string {
  return [e.role, e.text, e.accessibilityLabel]
    .filter((v): v is string => v != null)
    .map((v) => v.toLowerCase())
    .join('|');
}

function actionRequiresEnabled(action: ActionKind): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck'].includes(action);
}

function actionRequiresInteractive(action: ActionKind): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck', 'scroll'].includes(action);
}

function norm(s: string): string {
  return s.toLowerCase().trim();
}
