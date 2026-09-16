/**
 * Runtime verification for known locators — G01 (review v6 §7-8).
 *
 * "Cheap" verification: resolves the known locator to an observed element and
 * checks a small set of runtime signals WITHOUT running the full matcher pipeline.
 *
 * Produces a three-state result (PASS / FAIL / UNKNOWN) rather than a boolean:
 *   PASS    — all runnable checks passed → safe to execute with known locator
 *   FAIL    — at least one check definitively failed → reject, fall through
 *   UNKNOWN — retained for compatibility with stored evidence. Test-account
 *             execution does not infer failure from missing Appium metadata.
 *
 * Business impact remains attached to the evidence as ActionRisk, but missing
 * enabled/interactive metadata is not a failure in isolated test runs. Explicit
 * false values still fail; the driver action and postcondition are authoritative.
 */

import type { ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';
import { classifyActionRisk, type ActionRisk } from './ActionRisk.js';
import { normalizeHumanText } from '../core/text.js';

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

  // ── label check ───────────────────────────────────────────────────────────
  if (intent.label != null) {
    if (elementText == null) {
      checks.label = {
        status: 'SKIP',
        expected: intent.label,
        reason: 'element has no text or accessibilityLabel to compare',
      };
    } else {
      const expected = normalizeHumanText(intent.label);
      const actual = normalizeHumanText(elementText);
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
    }
  }

  // ── interactive check ─────────────────────────────────────────────────────
  if (needsInteractive(intent.action)) {
    if (element.interactive === false) {
      checks.interactive = { status: 'FAIL', actual: 'false', reason: 'element is not interactive' };
      failures.push('element is not interactive');
    }
  }

  // ── decision ──────────────────────────────────────────────────────────────

  if (failures.length > 0) {
    return { status: 'FAIL', checks, actionRisk, reason: failures[0] };
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
