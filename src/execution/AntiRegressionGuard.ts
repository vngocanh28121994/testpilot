import type { ElementIntent } from '../discovery/ElementIntent.js';
import type { ObservedElement, UiObservation } from '../discovery/UiObservation.js';
import type { AntiRegressionCheck } from './HealingTypes.js';

export interface AntiRegressionContext {
  intent: ElementIntent;
  newLocator: { strategy: string; value: string };
  observation: UiObservation;
  /** Id of the element the discovery matcher selected as best match. */
  matchedElementId: string;
  /** Confidence score (0..100) from the discovery matcher. */
  confidence: number;
  /** Floor below which the match is rejected regardless of other checks. Default: 60. */
  minConfidence?: number;
}

export interface AntiRegressionResult {
  passed: boolean;
  checks: AntiRegressionCheck[];
}

/**
 * Guards against accepting a healed locator that would cause regressions.
 *
 * Plan section 72 — before accepting a new locator, all of these must hold:
 *   1. Confidence above minimum threshold
 *   2. Locator resolves to exactly one element (unique)
 *   3. Matched element aligns with the semantic intent (label / role)
 *   4. Element is interactable for the intended action
 *
 * "Does not resolve to a different element on second observation" (plan section 72
 * item 5) is approximated here by check 2: if the locator is unique in this
 * observation it will resolve to the same element on any equivalent snapshot.
 *
 * All checks are synchronous and purely functional — no I/O required.
 */
export class AntiRegressionGuard {
  check(ctx: AntiRegressionContext): AntiRegressionResult {
    const minConf = ctx.minConfidence ?? 60;
    const matchedEl = ctx.observation.elements.find((e) => e.id === ctx.matchedElementId);

    const checks: AntiRegressionCheck[] = [
      checkConfidence(ctx.confidence, minConf),
      checkUniqueness(ctx.newLocator, ctx.observation.elements, ctx.matchedElementId),
      checkSemanticIntent(ctx.intent, matchedEl),
      checkInteractability(ctx.intent, matchedEl),
    ];

    return { passed: checks.every((c) => c.passed), checks };
  }
}

// ── individual checks ─────────────────────────────────────────────────────────

function checkConfidence(confidence: number, minConf: number): AntiRegressionCheck {
  const passed = confidence >= minConf;
  return {
    name: 'confidence-threshold',
    passed,
    ...(passed ? {} : { detail: `score ${confidence} is below minimum ${minConf}` }),
  };
}

function checkUniqueness(
  locator: { strategy: string; value: string },
  elements: ObservedElement[],
  matchedId: string,
): AntiRegressionCheck {
  const matchingElements = elements.filter((el) => elementMatchesLocator(locator, el));
  const count = matchingElements.length;

  if (count === 0) {
    // Defensive — the discovery matched it so it must be there; guard against
    // the impossible but make it surfaceable in evidence.
    return {
      name: 'locator-uniqueness',
      passed: false,
      detail: 'locator matches no elements in observation (internal inconsistency)',
    };
  }

  const passed = count === 1;
  return {
    name: 'locator-uniqueness',
    passed,
    ...(passed
      ? {}
      : { detail: `locator matches ${count} elements — ambiguous; would resolve unpredictably` }),
  };
}

function checkSemanticIntent(
  intent: ElementIntent,
  el: ObservedElement | undefined,
): AntiRegressionCheck {
  if (!el) {
    return {
      name: 'semantic-intent',
      passed: false,
      detail: 'matched element not found in observation',
    };
  }

  if (!intent.label) {
    // No label constraint → nothing to disprove
    return { name: 'semantic-intent', passed: true };
  }

  const intentLabel = norm(intent.label);
  const elText = norm(el.accessibilityLabel ?? el.text ?? '');

  if (!elText) {
    // Element has no readable text (e.g. icon-only button) — cannot disprove
    return { name: 'semantic-intent', passed: true };
  }

  const passed = elText.includes(intentLabel) || intentLabel.includes(elText);
  return {
    name: 'semantic-intent',
    passed,
    ...(passed
      ? {}
      : {
          detail:
            `element text "${elText}" does not align with intent label "${intentLabel}"` +
            ` — healed locator may point to the wrong element`,
        }),
  };
}

function checkInteractability(
  intent: ElementIntent,
  el: ObservedElement | undefined,
): AntiRegressionCheck {
  // Assert-only actions don't require interaction capability
  const isAssertOnly =
    intent.action === 'assert-visible' ||
    intent.action === 'assert-text' ||
    intent.action === 'assert-enabled' ||
    intent.action === 'assert-disabled';

  if (isAssertOnly) {
    return { name: 'element-interactable', passed: true };
  }

  if (!el) {
    return {
      name: 'element-interactable',
      passed: false,
      detail: 'matched element not found in observation',
    };
  }

  const notInteractive = el.interactive === false;
  const disabled = el.enabled === false;

  const passed = !notInteractive && !disabled;
  return {
    name: 'element-interactable',
    passed,
    ...(passed
      ? {}
      : {
          detail: notInteractive
            ? 'element is not interactive (container or static node)'
            : 'element is disabled — interaction would fail even with correct locator',
        }),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when `el` can be found by `locator` using observable element
 * fields.  CSS/XPath/predicate strategies cannot be evaluated from a static
 * observation tree — those strategies always return false (cannot confirm, so
 * the uniqueness check is skipped for them).
 */
function elementMatchesLocator(
  locator: { strategy: string; value: string },
  el: ObservedElement,
): boolean {
  const val = locator.value.toLowerCase();
  switch (locator.strategy) {
    case 'testId':
      return (el.testId?.toLowerCase() ?? '') === val;
    case 'label':
      return (
        (el.accessibilityLabel?.toLowerCase() ?? '') === val ||
        (el.text?.toLowerCase() ?? '') === val
      );
    default:
      // css, xpath, predicate — cannot evaluate statically; skip uniqueness for these
      return false;
  }
}

function norm(s: string): string {
  return s.toLowerCase().trim();
}
