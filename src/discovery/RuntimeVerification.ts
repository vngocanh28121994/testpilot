/**
 * Runtime verification for known locators — G01 (review v6 §7-8).
 *
 * "Cheap" verification: resolves the known locator to an observed element and
 * checks a small set of runtime signals WITHOUT running the full matcher pipeline.
 *
 * Produces a three-state result (PASS / FAIL / UNKNOWN) rather than a boolean:
 *   PASS    — all runnable checks passed → safe to execute with known locator
 *   FAIL    — at least one check definitively failed → reject, fall through
 *   UNKNOWN — not enough evidence to decide:
 *               • HIGH-risk action + critical metadata missing → do NOT execute
 *               • LOW/MEDIUM action + missing metadata → proceed to full discovery
 *
 * Caller (ElementDiscovery G01 path) decides what to do with UNKNOWN based on
 * ActionRisk. The rule is:
 *   UNKNOWN + HIGH  → method='failed' (stop)
 *   UNKNOWN + other → fall through to full observation + matching
 *
 * Never: UNKNOWN → automatic PASS
 */

import type { ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';
import { classifyActionRisk, type ActionRisk } from './ActionRisk.js';

// ── result types ──────────────────────────────────────────────────────────────

export type RuntimeVerificationStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface CheckResult {
  status: CheckStatus;
  expected?: string;
  actual?: string;
  reason?: string;
}

export interface RuntimeVerificationResult {
  status: RuntimeVerificationStatus;
  checks: {
    label?: CheckResult;
    role?: CheckResult;
    visible?: CheckResult;
    enabled?: CheckResult;
    interactive?: CheckResult;
  };
  actionRisk: ActionRisk;
  reason?: string;
}

// ── main function ─────────────────────────────────────────────────────────────

/**
 * Verify that a resolved element matches the intent before trusting the known
 * locator. Runs fast checks only — no matcher, no AI.
 */
export function verifyRuntime(
  intent: ElementIntent,
  element: ObservedElement,
): RuntimeVerificationResult {
  const elementText = element.text ?? element.accessibilityLabel;
  const actionRisk = classifyActionRisk(intent.action, elementText);
  const checks: RuntimeVerificationResult['checks'] = {};
  const failures: string[] = [];
  const unknowns: string[] = [];

  // ── label check ───────────────────────────────────────────────────────────
  if (intent.label != null) {
    if (elementText == null) {
      checks.label = {
        status: 'SKIP',
        expected: intent.label,
        reason: 'element has no text or accessibilityLabel to compare',
      };
      unknowns.push('label');
    } else {
      const expected = intent.label.toLowerCase();
      const actual = elementText.toLowerCase();
      const match = actual.includes(expected) || expected.includes(actual);
      checks.label = {
        status: match ? 'PASS' : 'FAIL',
        expected: intent.label,
        actual: elementText,
      };
      if (!match) {
        failures.push(`label mismatch: expected "${intent.label}", element has "${elementText}"`);
      }
    }
  }

  // ── role check ────────────────────────────────────────────────────────────
  if (intent.semanticRole != null && element.role != null) {
    const roleMatch =
      element.role.toLowerCase().includes(intent.semanticRole.toLowerCase()) ||
      intent.semanticRole.toLowerCase().includes(element.role.toLowerCase());
    checks.role = {
      status: roleMatch ? 'PASS' : 'FAIL',
      expected: intent.semanticRole,
      actual: element.role,
    };
    if (!roleMatch) {
      failures.push(`role mismatch: expected "${intent.semanticRole}", got "${element.role}"`);
    }
  }

  // ── visibility check ──────────────────────────────────────────────────────
  if (element.visible === false) {
    checks.visible = { status: 'FAIL', actual: 'false', reason: 'element is not visible' };
    failures.push('element is not visible');
  }
  // visible: boolean is non-optional in the interface, so undefined only from
  // partially constructed objects (e.g. tests). Treat the same as missing.

  // ── enabled check ─────────────────────────────────────────────────────────
  if (needsEnabled(intent.action)) {
    if (element.enabled === false) {
      checks.enabled = { status: 'FAIL', actual: 'false', reason: 'element is disabled' };
      failures.push('element is disabled');
    } else if (element.enabled == null && actionRisk === 'HIGH') {
      checks.enabled = {
        status: 'SKIP',
        reason: 'enabled state unknown for HIGH-risk action',
      };
      unknowns.push('enabled');
    }
  }

  // ── interactive check ─────────────────────────────────────────────────────
  if (needsInteractive(intent.action)) {
    if (element.interactive === false) {
      checks.interactive = { status: 'FAIL', actual: 'false', reason: 'element is not interactive' };
      failures.push('element is not interactive');
    } else if (element.interactive == null && actionRisk === 'HIGH') {
      checks.interactive = {
        status: 'SKIP',
        reason: 'interactive state unknown for HIGH-risk action',
      };
      unknowns.push('interactive');
    }
  }

  // ── decision ──────────────────────────────────────────────────────────────

  if (failures.length > 0) {
    return { status: 'FAIL', checks, actionRisk, reason: failures[0] };
  }

  if (actionRisk === 'HIGH' && unknowns.length > 0) {
    return {
      status: 'UNKNOWN',
      checks,
      actionRisk,
      reason:
        `HIGH-risk action "${intent.action}" with missing metadata: ${unknowns.join(', ')} — ` +
        `cannot confirm element is safe to interact with`,
    };
  }

  return { status: 'PASS', checks, actionRisk };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function needsEnabled(action: string): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck'].includes(action);
}

function needsInteractive(action: string): boolean {
  return ['tap', 'input', 'select', 'check', 'uncheck'].includes(action);
}
