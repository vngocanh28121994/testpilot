/**
 * Action risk classification — G06 (review v6 §16).
 *
 * Separates action risk from match confidence. A high-confidence match does
 * NOT mean it is safe to execute a high-impact action — missing runtime
 * metadata must become UNKNOWN (not a silent PASS) for destructive actions.
 *
 * Risk levels:
 *   HIGH   — destructive or irreversible: delete, transfer, submit, purchase …
 *   MEDIUM — state-changing: input, select, check/uncheck
 *   LOW    — read or navigate: scroll, swipe, assert-*
 *
 * Risk is determined from BOTH the action kind and the element's visible text
 * (because "submit" and "delete" are expressed as `action: 'tap'` in TestPilot
 * with the semantic meaning carried by the element label).
 *
 * HIGH-risk policy: UNKNOWN metadata → do NOT execute, re-observe or stop.
 * Never silently treat missing evidence as a PASS for destructive actions.
 */

export type ActionRisk = 'LOW' | 'MEDIUM' | 'HIGH';

const HIGH_RISK_KEYWORDS: readonly string[] = [
  'delete',
  'remove',
  'transfer',
  'withdraw',
  'pay',
  'checkout',
  'submit',
  'confirm',
  'buy',
  'sell',
  'purchase',
  'deactivate',
  'cancel account',
  'unsubscribe',
  'erase',
  'clear all',
  'reset',
];

const INTERACTIVE_ACTIONS: ReadonlySet<string> = new Set([
  'tap',
  'input',
  'select',
  'check',
  'uncheck',
]);

/**
 * Classify the risk level for an action.
 *
 * @param action        The action kind from ElementIntent (e.g. 'tap', 'input').
 * @param elementText   Visible text / accessibility label of the target element.
 *                      When provided, used to detect HIGH-risk semantic actions
 *                      (e.g. `tap` on "Delete Account" → HIGH).
 * @param extraHighRisk Additional application-specific high-risk keywords
 *                      (configurable per project).
 */
export function classifyActionRisk(
  action: string,
  elementText?: string,
  extraHighRisk: readonly string[] = [],
): ActionRisk {
  if (elementText) {
    const lower = elementText.toLowerCase();
    if ([...HIGH_RISK_KEYWORDS, ...extraHighRisk].some((k) => lower.includes(k.toLowerCase()))) {
      return 'HIGH';
    }
  }

  if (INTERACTIVE_ACTIONS.has(action.toLowerCase())) return 'MEDIUM';
  return 'LOW';
}

export const DEFAULT_HIGH_RISK_KEYWORDS = HIGH_RISK_KEYWORDS;
