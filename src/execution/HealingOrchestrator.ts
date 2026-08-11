import type { ElementDef } from '../core/types.js';
import type { ElementDiscovery } from '../discovery/ElementDiscovery.js';
import { buildElementIntent } from '../discovery/DriverObservationAdapter.js';
import type { RuntimeRegistry } from '../discovery/RuntimeRegistry.js';
import type { ActionKind } from '../discovery/ElementIntent.js';
import type { NormalizedFailure } from './ExecutionTypes.js';
import type { HealingResult, HealingMethod } from './HealingTypes.js';
import type { DiscoveryMethod } from '../discovery/ElementDiscovery.js';
import { HealingPolicy } from './HealingPolicy.js';
import { AntiRegressionGuard } from './AntiRegressionGuard.js';

export interface HealOptions {
  platform?: string;
  /** Confidence floor for discovery (default: 40 — permissive in failure context). */
  minConfidence?: number;
  /**
   * The action that originally triggered the failure.  Used in the
   * anti-regression guard to check interactability for the real action.
   * Defaults to 'tap' (strictest check: requires enabled + interactive).
   *
   * Discovery itself always uses 'assert-visible' so it can find the element
   * even when the interaction check would block it; the guard then applies the
   * real action's requirements before the locator is accepted.
   */
  action?: ActionKind;
}

/**
 * Coordinates the full healing pipeline for a failed element interaction.
 *
 * Flow (plan sections 18, 72, 73):
 *   1. HealingPolicy.decide(failure) — gate by failure category
 *   2. ElementDiscovery.discover()   — find element via live observation
 *   3. AntiRegressionGuard.check()  — validate uniqueness, semantic match,
 *                                      confidence, interactability
 *   4. RuntimeRegistry.markHealed() — record outcome in registry
 *
 * Returns HealingResult with healed=true only when steps 1-4 all pass.
 * `retryPassed` is always false on return — the executor must re-run the
 * step and update this field (plan section 73: confidence AND verification
 * AND retry pass → HEALING_SUCCESS).
 */
export class HealingOrchestrator {
  constructor(
    private readonly policy: HealingPolicy,
    private readonly discovery: ElementDiscovery,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly guard: AntiRegressionGuard,
  ) {}

  async heal(
    elementId: string,
    elementDef: ElementDef,
    failure: NormalizedFailure,
    opts: HealOptions = {},
  ): Promise<HealingResult> {
    const evidence: string[] = [];

    // ── 1. Policy gate ────────────────────────────────────────────────────────
    const decision = this.policy.decide(failure);
    evidence.push(`[policy] ${decision.reason}`);

    if (!decision.canAutoHeal) {
      return failed('none', evidence, `policy blocked auto-heal: ${decision.reason}`);
    }

    // ── 2. Discovery ──────────────────────────────────────────────────────────
    //
    // Two separate intents:
    //   discoveryIntent — action: 'assert-visible' so the ElementVerifier is
    //                     permissive: we just want to LOCATE the element, not
    //                     pre-judge whether it's tappable.
    //   guardIntent     — action from opts (default: 'tap') so AntiRegressionGuard
    //                     applies the real interaction requirements before the
    //                     healed locator is accepted.
    // discoveryIntent uses 'assert-visible' (buildElementIntent's default) so
    // the verifier is permissive: locate the element without prejudging
    // whether it is tappable — that is anti-regression's responsibility.
    const discoveryIntent = buildElementIntent(elementId, elementDef);
    const guardIntent = { ...discoveryIntent, action: opts.action ?? ('tap' as const) };
    const minConf = opts.minConfidence ?? 40;

    let discoveryResult;
    try {
      discoveryResult = await this.discovery.discover(discoveryIntent, {
        platform: opts.platform,
        minConfidence: minConf,
        context: 'healing',
      });
    } catch (err) {
      evidence.push(`[discovery] threw: ${(err as Error).message}`);
      return failed('none', evidence, 'discovery threw an error');
    }

    for (const line of discoveryResult.evidence) evidence.push(`[discovery] ${line}`);

    if (discoveryResult.method === 'failed' || !discoveryResult.locator) {
      return failed('none', evidence, 'discovery found no matching element');
    }

    const newLocator = discoveryResult.locator;

    // ── 3a. Known-locator fast-path ───────────────────────────────────────────
    // The registry already has a verified/healed locator — trust it, skip
    // the anti-regression guard (which needs a live observation).
    if (discoveryResult.method === 'known-locator') {
      evidence.push('[anti-regression] skipped — using existing verified registry locator');
      return {
        healed: true,
        newLocator,
        confidence: 100,
        method: 'known-fallback',
        evidence,
        retryPassed: false,
        antiRegressionPassed: true,
      };
    }

    // ── 3b. Anti-regression guard ─────────────────────────────────────────────
    const match = discoveryResult.match;
    const observation = discoveryResult.observation;

    if (!observation || !match) {
      evidence.push('[anti-regression] skipped — no observation available');
      return failed(
        toHealingMethod(discoveryResult.method),
        evidence,
        'verification passed but no observation for anti-regression check',
        newLocator,
        match?.confidence ?? 0,
      );
    }

    const guardResult = this.guard.check({
      intent: guardIntent,
      newLocator,
      observation,
      matchedElementId: match.observedElementId,
      confidence: match.confidence,
      minConfidence: minConf,
    });

    evidence.push(
      `[anti-regression] ${guardResult.passed ? 'PASSED' : 'FAILED'}`,
      ...guardResult.checks.map(
        (c) => `  · ${c.name}: ${c.passed ? 'OK' : `FAIL — ${c.detail ?? ''}`}`,
      ),
    );

    if (!guardResult.passed) {
      // Reject the locator so it won't be re-attempted on future runs
      this.runtimeRegistry.markRejected(elementId, newLocator.strategy, newLocator.value);
      evidence.push('[registry] locator marked REJECTED');

      return {
        healed: false,
        newLocator,
        confidence: match.confidence,
        method: toHealingMethod(discoveryResult.method),
        evidence,
        retryPassed: false,
        antiRegressionPassed: false,
        antiRegressionChecks: guardResult.checks,
        rejectionReason:
          guardResult.checks.find((c) => !c.passed)?.detail ?? 'anti-regression failed',
      };
    }

    // ── 4. Registry update — mark as healed ───────────────────────────────────
    this.runtimeRegistry.markHealed(elementId, newLocator.strategy, newLocator.value);
    evidence.push('[registry] locator marked HEALED');

    return {
      healed: true,
      newLocator,
      confidence: match.confidence,
      method: toHealingMethod(discoveryResult.method),
      evidence,
      retryPassed: false, // executor fills this in after retry
      antiRegressionPassed: true,
      antiRegressionChecks: guardResult.checks,
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function failed(
  method: HealingMethod,
  evidence: string[],
  rejectionReason: string,
  newLocator?: { strategy: string; value: string },
  confidence = 0,
): HealingResult {
  return {
    healed: false,
    ...(newLocator ? { newLocator } : {}),
    confidence,
    method,
    evidence,
    retryPassed: false,
    antiRegressionPassed: false,
    rejectionReason,
  };
}

function toHealingMethod(dm: DiscoveryMethod): HealingMethod {
  switch (dm) {
    case 'known-locator':  return 'known-fallback';
    case 'deterministic':  return 'runtime-observation';
    case 'semantic-ai':    return 'semantic-ai';
    case 'vision':         return 'vision';
    default:               return 'none';
  }
}
