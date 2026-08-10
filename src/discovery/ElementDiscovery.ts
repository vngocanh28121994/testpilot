/**
 * Full deterministic element discovery pipeline.
 *
 * Decision tree (plan section 47.6):
 *
 *   1. Known verified locator? (RuntimeRegistry)
 *      └─ YES → return it — skip observation entirely
 *      └─ NO  → continue
 *   2. Runtime observation (ObservationProvider.observe())
 *   3. Deterministic matching (DeterministicMatcher)
 *      └─ no candidates above minConfidence → method='failed'
 *   4. Verification (StandardElementVerifier)
 *      └─ fails  → return result with verified=false
 *      └─ passes → store in RuntimeRegistry, return result
 *
 * AI / Vision fallback is intentionally absent — those live in separate
 * adapters (SemanticElementDiscovery, VisionElementDiscovery) that the
 * orchestrator calls when this pipeline returns method='failed'.
 */

import type { ElementIntent } from './ElementIntent.js';
import type { UiObservation } from './UiObservation.js';
import type { ElementMatch } from './ElementMatcher.js';
import type { ElementVerification } from './ElementVerifier.js';
import { DeterministicMatcher, type MatchOptions } from './ElementMatcher.js';
import { StandardElementVerifier } from './ElementVerifier.js';
import { RuntimeRegistry, type RuntimeLocator } from './RuntimeRegistry.js';
import { ConfidenceScorer } from './ConfidenceScorer.js';
import { checkKnownLocator } from './KnownLocatorLookup.js';

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
  /** The raw observation used for matching (absent for 'known-locator'). */
  observation?: UiObservation;
  /** Audit trail — each step appends one or more lines. */
  evidence: string[];
}

// ── provider interface ────────────────────────────────────────────────────────

export interface ObservationProvider {
  /** Capture a fresh UI snapshot. Called only when no known locator exists. */
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

    // ── 1. Known verified locator ─────────────────────────────────────────────
    const known = checkKnownLocator(intent, this.runtimeRegistry, opts.platform);
    if (known.found) {
      const { strategy, value, status } = known.locator;
      evidence.push(`known ${status} locator: ${strategy}="${value}"`);
      return {
        intent,
        method: 'known-locator',
        locator: { strategy, value },
        evidence,
      };
    }
    evidence.push('no known verified locator → runtime observation');

    // ── 2. Runtime observation ────────────────────────────────────────────────
    let observation: UiObservation;
    try {
      observation = await this.observationProvider.observe();
      evidence.push(
        `observed ${observation.elements.length} element(s) via ${observation.source}`,
      );
    } catch (err) {
      evidence.push(`observation failed: ${(err as Error).message}`);
      return { intent, method: 'failed', evidence };
    }

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

    const best = above[0]!;
    evidence.push(`best match: id=${best.observedElementId} confidence=${best.confidence}`);

    // ── 4. Verification ───────────────────────────────────────────────────────
    const candidateEl = observation.elements.find(
      (e) => e.id === best.observedElementId,
    );
    if (!candidateEl) {
      evidence.push('internal: candidate element missing from observation');
      return { intent, method: 'failed', observation, evidence };
    }

    const verification = this.verifier.verify(
      intent,
      candidateEl,
      observation.elements,
    );
    evidence.push(
      `verification: ${verification.passed ? 'PASSED' : 'FAILED'} score=${verification.score}`,
    );
    for (const e of verification.evidence) evidence.push(`  · ${e}`);

    if (!verification.passed) {
      return {
        intent,
        method: 'deterministic',
        match: { ...best, verified: false },
        verification,
        observation,
        evidence,
      };
    }

    // ── 5. Store in RuntimeRegistry ───────────────────────────────────────────
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
      evidence.push(
        `stored: ${best.locator.strategy}="${best.locator.value}" in RuntimeRegistry`,
      );
    }

    return {
      intent,
      method: 'deterministic',
      locator: best.locator,
      match: { ...best, verified: true },
      verification,
      observation,
      evidence,
    };
  }
}
