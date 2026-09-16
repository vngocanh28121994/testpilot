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
import { textMatch } from './ConfidenceScorer.js';
import { normalizeHumanText } from '../core/text.js';

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
    opts?: { allowExactTextProxy?: boolean; visualTextEvidence?: string },
  ): ElementVerification;
}

export class StandardElementVerifier implements ElementVerifier {
  verify(
    intent: ElementIntent,
    candidate: ObservedElement,
    allElements: ObservedElement[] = [],
    opts: { allowExactTextProxy?: boolean; visualTextEvidence?: string } = {},
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

    const exactTextProxy = opts.allowExactTextProxy === true
      && intent.action === 'tap'
      && candidate.visible
      && isUnique(candidate, allElements)
      && hasExactSemanticName(intent, candidate);
    if (actionRequiresInteractive(intent.action)) {
      checks.interactive = candidate.interactive !== false || exactTextProxy;
      if (candidate.interactive === false && !exactTextProxy) {
        evidence.push('element is not interactive');
      } else if (exactTextProxy) {
        evidence.push('exact unique text leaf accepted as a proxy for bounded outcome validation');
      }
    }

    // ── semantic checks ───────────────────────────────────────────────────────

    if (intent.semanticRole != null && candidate.role != null) {
      checks.roleMatch = rolesCompatible(intent.action, intent.semanticRole, candidate.role);
      if (!checks.roleMatch) {
        evidence.push(
          `role mismatch: expected "${intent.semanticRole}", found "${candidate.role}"`,
        );
      }
    }

    if (intent.label != null) {
      const candidateText =
        candidate.accessibilityLabel ?? candidate.text ?? candidate.placeholder ?? '';
      const visualMatch = opts.visualTextEvidence != null
        && textMatch(opts.visualTextEvidence, intent.label) !== 'none';
      checks.labelMatch = textMatch(candidateText, intent.label) !== 'none' || visualMatch;
      if (!checks.labelMatch) {
        evidence.push(
          `label mismatch: expected "${intent.label}", element has "${candidateText || '(empty)'}"`,
        );
      } else if (visualMatch && textMatch(candidateText, intent.label) === 'none') {
        evidence.push(
          `visual text evidence "${opts.visualTextEvidence}" supplements incomplete UI-tree text "${candidateText || '(empty)'}"`,
        );
      }
    }

    // ── uniqueness check ──────────────────────────────────────────────────────

    if (allElements.length > 1) {
      const sig = elementSignature(candidate);
      const duplicates = allElements.filter(
        (e) => e.id !== candidate.id && e.visible !== false && elementSignature(e) === sig,
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

/** Kept in step with InteractionSafety's signature — placeholder included. */
function elementSignature(e: ObservedElement): string {
  return [e.role, e.text, e.accessibilityLabel, e.placeholder]
    .filter((v): v is string => v != null)
    .map((v) => v.toLowerCase())
    .join('|');
}

function isUnique(candidate: ObservedElement, all: ObservedElement[]): boolean {
  if (all.length <= 1) return true;
  const sig = elementSignature(candidate);
  return all.filter(
    (element) => element.id !== candidate.id
      && element.visible !== false
      && elementSignature(element) === sig,
  ).length === 0;
}

function hasExactSemanticName(intent: ElementIntent, candidate: ObservedElement): boolean {
  const wanted = intent.text ?? intent.label;
  if (!wanted) return false;
  return [candidate.accessibilityLabel, candidate.text, candidate.placeholder]
    .some((value) => value != null && textMatch(value, wanted) === 'exact');
}

function actionRequiresEnabled(action: ActionKind): boolean {
  return ['tap', 'drag', 'input', 'select', 'check', 'uncheck'].includes(action);
}

function actionRequiresInteractive(action: ActionKind): boolean {
  return ['tap', 'drag', 'input', 'select', 'check', 'uncheck', 'scroll'].includes(action);
}

function norm(s: string): string {
  return normalizeHumanText(s);
}

function rolesCompatible(action: string, expected: string, actual: string): boolean {
  if (norm(expected) === norm(actual)) return true;
  if (action !== 'input' || norm(expected) !== 'textbox') return false;
  return ['combobox', 'searchbox', 'spinbutton'].includes(norm(actual));
}
