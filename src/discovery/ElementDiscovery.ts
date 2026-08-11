/**
 * Full deterministic element discovery pipeline.
 *
 * Decision tree (plan §47.6 + review v5 G01/G05/G06):
 *
 *   1. Known verified locator? (RuntimeRegistry)
 *      └─ YES → observe → semantic verification (G01)
 *               ├─ PASS → return (known-locator method)
 *               └─ FAIL → mark rejected, fall through with observation
 *      └─ NO  → continue
 *   2. Runtime observation (ObservationProvider.observe())
 *   3. Deterministic matching (DeterministicMatcher)
 *      └─ no candidates above minConfidence → method='failed'
 *   4. Ambiguity gate (G05)
 *      └─ AMBIGUOUS / INSUFFICIENT → method='failed' with outcome in evidence
 *   5. Interaction safety check (G06)
 *      └─ UNSAFE / AMBIGUOUS → method='failed' with reason in evidence
 *   6. Verification (StandardElementVerifier) — G04: single authoritative engine
 *      └─ fails  → return result with verified=false
 *      └─ passes → store in RuntimeRegistry, return result
 *
 * AI / Vision fallback is intentionally absent — those live in separate
 * adapters (SemanticElementDiscovery, VisionElementDiscovery) that the
 * orchestrator calls when this pipeline returns method='failed'.
 */

import type { ElementIntent } from './ElementIntent.js';
import type { UiObservation, ObservedElement } from './UiObservation.js';
import type { ElementMatch } from './ElementMatcher.js';
import type { ElementVerification } from './ElementVerifier.js';
import { DeterministicMatcher, type MatchOptions } from './ElementMatcher.js';
import { StandardElementVerifier } from './ElementVerifier.js';
import { RuntimeRegistry, type RuntimeLocator } from './RuntimeRegistry.js';
import { ConfidenceScorer } from './ConfidenceScorer.js';
import { checkKnownLocator } from './KnownLocatorLookup.js';
import { checkAmbiguity, type AmbiguityCheckResult, type AmbiguityPolicy, DEFAULT_AMBIGUITY_POLICY } from './AmbiguityPolicy.js';
import { checkInteractionSafety, type SafetyCheckResult } from './InteractionSafety.js';
import { verifyRuntime, type RuntimeVerificationResult } from './RuntimeVerification.js';

// ── result types ──────────────────────────────────────────────────────────────

export type DiscoveryMethod =
  | 'known-locator'
  | 'deterministic'
  | 'semantic-ai'
  | 'vision'
  | 'failed';

export interface DiscoveryResult {
  intent: ElementIntent;
  method: DiscoveryMethod;
  /** Best locator found — present unless method is 'failed'. */
  locator?: { strategy: string; value: string };
  /** Match detail from the observation step. */
  match?: ElementMatch;
  /** Verification result for the best match. */
  verification?: ElementVerification;
  /** Ambiguity gate result — present when G05 check ran. */
  ambiguity?: AmbiguityCheckResult;
  /** Interaction safety result — present when G06 check ran. */
  safety?: SafetyCheckResult;
  /** G01 runtime verification result — present when a known locator was checked. */
  runtimeVerification?: RuntimeVerificationResult;
  /** The raw observation used for matching (absent for successful 'known-locator'). */
  observation?: UiObservation;
  /** Audit trail — each step appends one or more lines. */
  evidence: string[];
}

// ── provider interface ────────────────────────────────────────────────────────

export interface ObservationProvider {
  /** Capture a fresh UI snapshot. */
  observe(): Promise<UiObservation>;
}

// ── options ───────────────────────────────────────────────────────────────────

export interface DiscoveryOptions {
  /** Current platform — used for runtime registry lookup. */
  platform?: string;
  /** Current screen name — forwarded to DeterministicMatcher for the bonus. */
  screen?: string;
  /** Confidence floor for accepting a match (0..100). Default: 60. */
  minConfidence?: number;
  /** Ambiguity policy override. */
  ambiguityPolicy?: AmbiguityPolicy;
  /**
   * When true, skip semantic re-verification of known locators.
   * Use only in performance-critical paths where the observation cost cannot
   * be justified and the locator source is 'human-approved'.
   */
  skipKnownLocatorVerification?: boolean;
}

const DEFAULT_MIN_CONFIDENCE = 60;

// ── main class ────────────────────────────────────────────────────────────────

export class ElementDiscovery {
  private readonly matcher: DeterministicMatcher;
  private readonly verifier: StandardElementVerifier;

  constructor(
    private readonly observationProvider: ObservationProvider,
    private readonly runtimeRegistry: RuntimeRegistry,
    scorer?: ConfidenceScorer,
  ) {
    this.matcher = new DeterministicMatcher(scorer);
    this.verifier = new StandardElementVerifier();
  }

  async discover(
    intent: ElementIntent,
    opts: DiscoveryOptions = {},
  ): Promise<DiscoveryResult> {
    const evidence: string[] = [];
    const minConf = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const ambiguityPolicy = opts.ambiguityPolicy ?? DEFAULT_AMBIGUITY_POLICY;

    // ── 1. Known verified locator (G01: now includes semantic verification) ────
    const known = checkKnownLocator(intent, this.runtimeRegistry, opts.platform);
    if (known.found) {
      const { strategy, value, status } = known.locator;
      evidence.push(`known ${status} locator: ${strategy}="${value}"`);

      if (opts.skipKnownLocatorVerification) {
        evidence.push('known-locator semantic verification skipped (skipKnownLocatorVerification=true)');
        return { intent, method: 'known-locator', locator: { strategy, value }, evidence };
      }

      // Observe to semantically verify the locator still points to the intended element
      let obs: UiObservation;
      try {
        obs = await this.observationProvider.observe();
        evidence.push(`G01 verify: observed ${obs.elements.length} element(s)`);
      } catch (err) {
        // Cannot observe — return known locator with a warning (best-effort)
        evidence.push(`G01 verify: observation failed (${(err as Error).message}) — using known locator unverified`);
        return { intent, method: 'known-locator', locator: { strategy, value }, evidence };
      }

      const el = findElementByLocator(obs, strategy, value);
      if (el) {
        // G01: cheap runtime verification (PASS / FAIL / UNKNOWN)
        const runtimeVerif = verifyRuntime(intent, el);
        evidence.push(`G01 runtime check: ${runtimeVerif.status} (risk=${runtimeVerif.actionRisk})`);
        if (runtimeVerif.reason) evidence.push(`  · ${runtimeVerif.reason}`);

        if (runtimeVerif.status === 'PASS') {
          return {
            intent,
            method: 'known-locator',
            locator: { strategy, value },
            runtimeVerification: runtimeVerif,
            observation: obs,
            evidence,
          };
        }

        if (runtimeVerif.status === 'UNKNOWN') {
          // HIGH-risk action + missing metadata: never auto-PASS, reject locator.
          // Fall through to full observation-based discovery (already have obs).
          evidence.push(
            `G01 UNKNOWN: ${runtimeVerif.reason ?? 'missing metadata for HIGH-risk action'} — ` +
            `rejecting known locator, starting full discovery`,
          );
        } else {
          // FAIL: locator points to the wrong element
          evidence.push(`G01 FAIL: known locator ${strategy}="${value}" points to wrong element — rejected`);
        }

        this.runtimeRegistry.markRejected(intent.id, strategy, value);
        // Fall through using the already-obtained observation (no second observe())
        return this.discoverFromObservation(intent, obs, opts, minConf, ambiguityPolicy, evidence);
      } else {
        evidence.push(`known locator ${strategy}="${value}" not found in observation — rejected, starting discovery`);
        this.runtimeRegistry.markRejected(intent.id, strategy, value);
      }

      // Fall through using the already-obtained observation (no second observe())
      return this.discoverFromObservation(intent, obs, opts, minConf, ambiguityPolicy, evidence);
    }

    evidence.push('no known verified locator → runtime observation');

    // ── 2. Runtime observation ────────────────────────────────────────────────
    let observation: UiObservation;
    try {
      observation = await this.observationProvider.observe();
      evidence.push(`observed ${observation.elements.length} element(s) via ${observation.source}`);
    } catch (err) {
      evidence.push(`observation failed: ${(err as Error).message}`);
      return { intent, method: 'failed', evidence };
    }

    return this.discoverFromObservation(intent, observation, opts, minConf, ambiguityPolicy, evidence);
  }

  /**
   * Steps 3-6 of the pipeline, run against an already-obtained observation.
   * Extracted so that the known-locator FAIL path can reuse the same observation.
   */
  private discoverFromObservation(
    intent: ElementIntent,
    observation: UiObservation,
    opts: DiscoveryOptions,
    minConf: number,
    ambiguityPolicy: AmbiguityPolicy,
    evidence: string[],
  ): DiscoveryResult {
    // ── 3. Deterministic matching ─────────────────────────────────────────────
    const matchOpts: MatchOptions = { screen: opts.screen };
    const matches = this.matcher.match(intent, observation, matchOpts);
    const above = matches.filter((m) => m.confidence >= minConf);

    evidence.push(
      `matcher: ${matches.length} candidate(s), ${above.length} above threshold (${minConf})`,
    );

    if (above.length === 0) {
      if (matches.length > 0) {
        const top = matches[0]!;
        evidence.push(`  best below threshold: id=${top.observedElementId} confidence=${top.confidence}`);
      }
      return { intent, method: 'failed', observation, evidence };
    }

    // ── 4. Ambiguity gate (G05) ───────────────────────────────────────────────
    // `above` is already filtered by minConf, so align the policy floor to it.
    // This prevents the ambiguity check from re-applying a stricter threshold
    // when the caller has intentionally lowered minConf (e.g. healing fallback).
    const scores = above.map((m) => m.confidence);
    const effectiveAmbiguityPolicy: AmbiguityPolicy = {
      ...ambiguityPolicy,
      minimumConfidence: minConf,
    };
    const ambiguity = checkAmbiguity(scores, effectiveAmbiguityPolicy);
    evidence.push(`G05 ambiguity: ${ambiguity.outcome} — ${ambiguity.reason}`);

    if (ambiguity.outcome === 'AMBIGUOUS' || ambiguity.outcome === 'INSUFFICIENT') {
      return { intent, method: 'failed', ambiguity, observation, evidence };
    }

    const best = above[0]!;
    evidence.push(`best match: id=${best.observedElementId} confidence=${best.confidence}`);

    const candidateEl = observation.elements.find((e) => e.id === best.observedElementId);
    if (!candidateEl) {
      evidence.push('internal: candidate element missing from observation');
      return { intent, method: 'failed', observation, evidence };
    }

    // ── 5. Interaction safety check (G06) ─────────────────────────────────────
    const safety = checkInteractionSafety(intent, candidateEl, observation.elements);
    evidence.push(`G06 safety: ${safety.safety} — ${safety.reason}`);
    for (const e of safety.evidence) evidence.push(`  · ${e}`);

    if (safety.safety !== 'SAFE') {
      return { intent, method: 'failed', ambiguity, safety, observation, evidence };
    }

    // ── 6. Verification (G04: single authoritative engine) ────────────────────
    const verification = this.verifier.verify(intent, candidateEl, observation.elements);
    evidence.push(
      `verification: ${verification.passed ? 'PASSED' : 'FAILED'} score=${verification.score}`,
    );
    for (const e of verification.evidence) evidence.push(`  · ${e}`);

    if (!verification.passed) {
      return {
        intent,
        method: 'deterministic',
        match: { ...best, verified: false },
        ambiguity,
        safety,
        verification,
        observation,
        evidence,
      };
    }

    // ── 7. Store in RuntimeRegistry ───────────────────────────────────────────
    if (best.locator) {
      const locatorToStore: RuntimeLocator = {
        strategy: best.locator.strategy,
        value: best.locator.value,
        source: 'runtime-observed',
        status: 'verified',
        confidence: best.confidence / 100,
        verifiedAt: new Date().toISOString(),
        ...(opts.platform ? { platform: opts.platform } : {}),
      };
      this.runtimeRegistry.upsertLocator(intent.id, locatorToStore);
      evidence.push(`stored: ${best.locator.strategy}="${best.locator.value}" in RuntimeRegistry`);
    }

    return {
      intent,
      method: 'deterministic',
      locator: best.locator,
      match: { ...best, verified: true },
      ambiguity,
      safety,
      verification,
      observation,
      evidence,
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Find an ObservedElement that corresponds to a known locator strategy+value.
 * Used by the G01 known-locator semantic verification step.
 *
 * Matching is best-effort: we check the fields that each strategy populates.
 * Returns undefined when no matching element is found in the observation.
 */
export function findElementByLocator(
  obs: UiObservation,
  strategy: string,
  value: string,
): ObservedElement | undefined {
  const s = strategy.toLowerCase();
  return obs.elements.find((el) => {
    // First try providerElementId for MCP-sourced locators (G02)
    if (el.providerElementId === value) return true;

    switch (s) {
      case 'id':
      case 'accessibility id':
        return (
          el.resourceId === value ||
          el.testId === value ||
          el.accessibilityLabel === value
        );
      case 'xpath':
        return el.xpath === value;
      case 'css selector':
      case 'css':
        return el.css === value;
      case 'text':
        return el.text === value;
      default:
        // Fallback: any field equality
        return (
          el.resourceId === value ||
          el.testId === value ||
          el.accessibilityLabel === value ||
          el.text === value
        );
    }
  });
}
