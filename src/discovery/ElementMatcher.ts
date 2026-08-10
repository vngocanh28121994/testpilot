/**
 * Matches an ElementIntent against an observed UI snapshot.
 *
 * DeterministicMatcher uses only real runtime evidence — no AI calls.
 * It scores every observed element against the intent and returns results
 * sorted by confidence descending. The caller decides which threshold
 * to act on (see ConfidenceScorer.verdict()).
 *
 * Deterministic preference order:
 *   1. exact testId
 *   2. exact resourceId
 *   3. exact accessibility label
 *   4. text + role
 *   5. placeholder + role
 *   6. role + context
 *   7. historical locator
 *
 * Do NOT call AI from here. AI/Vision fallback lives in a separate adapter.
 */

import type { ElementIntent } from './ElementIntent.js';
import type { ObservedElement, UiObservation } from './UiObservation.js';
import { ConfidenceScorer, type MatchScore } from './ConfidenceScorer.js';

export type MatchMethod = 'known-locator' | 'deterministic' | 'semantic-ai' | 'vision';

export interface ElementMatch {
  intentId: string;
  observedElementId: string;
  /** 0..100 — clamped score for display. */
  confidence: number;
  method: MatchMethod;
  reasons: string[];
  penalties: string[];
  verified: boolean;
  locator?: { strategy: string; value: string };
  /** Raw scoring detail for debugging / audit. */
  score: MatchScore;
}

export interface MatchOptions {
  /** Current screen name — used for same-screen bonus. */
  screen?: string;
  /** Observed element ids known to have been successful locators historically. */
  historicalWinners?: Set<string>;
  /** Already-known locator to try first (from RuntimeRegistry). */
  knownLocator?: { strategy: string; value: string };
}

export interface ElementMatcher {
  match(
    intent: ElementIntent,
    observation: UiObservation,
    opts?: MatchOptions,
  ): ElementMatch[];
}

export class DeterministicMatcher implements ElementMatcher {
  private readonly scorer: ConfidenceScorer;

  constructor(scorer?: ConfidenceScorer) {
    this.scorer = scorer ?? new ConfidenceScorer();
  }

  match(
    intent: ElementIntent,
    observation: UiObservation,
    opts: MatchOptions = {},
  ): ElementMatch[] {
    const allElements = observation.elements;
    const scored: Array<{ element: ObservedElement; matchScore: MatchScore }> = [];

    for (const element of allElements) {
      const matchScore = this.scorer.score(intent, element, {
        allCandidates: allElements,
        screen: opts.screen,
        historicalWinner: opts.historicalWinners?.has(element.id),
      });

      // Include only elements with at least one positive signal.
      if (matchScore.score > 0) {
        scored.push({ element, matchScore });
      }
    }

    // Sort descending by score — no ties allowed; stable sort preserves
    // observation order within equal-score groups.
    scored.sort((a, b) => b.matchScore.score - a.matchScore.score);

    return scored.map(({ element, matchScore }) => ({
      intentId: intent.id,
      observedElementId: element.id,
      confidence: clamp(matchScore.score, 0, 100),
      method: 'deterministic',
      reasons: matchScore.reasons,
      penalties: matchScore.penalties,
      verified: false,
      locator: bestLocator(element),
      score: matchScore,
    }));
  }
}

/** Derive the most stable locator from what the platform exposed. */
function bestLocator(el: ObservedElement): { strategy: string; value: string } | undefined {
  if (el.testId) return { strategy: 'testId', value: el.testId };
  if (el.resourceId) return { strategy: 'resourceId', value: el.resourceId };
  if (el.accessibilityLabel) return { strategy: 'accessibility', value: el.accessibilityLabel };
  if (el.css) return { strategy: 'css', value: el.css };
  if (el.xpath) return { strategy: 'xpath', value: el.xpath };
  return undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
