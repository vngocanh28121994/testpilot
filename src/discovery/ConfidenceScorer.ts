/**
 * Evidence-based confidence scorer for element candidates.
 *
 * Scores encode how reliable the match is, not how convenient the locator is.
 * All weights and thresholds are configurable so teams can tune for their
 * risk tolerance without touching business logic.
 *
 * Threshold policy (configurable):
 *   >= 85  → accept after verification
 *   60–84  → additional verification required
 *   < 60   → reject / report, do not interact
 */

import type { ElementIntent } from './ElementIntent.js';
import type { ObservedElement } from './UiObservation.js';

export interface MatchScore {
  candidateId: string;
  score: number;
  reasons: string[];
  penalties: string[];
}

export interface ScorerWeights {
  exactTestId: number;
  exactResourceId: number;
  exactAccessibility: number;
  exactText: number;
  exactPlaceholder: number;
  sameRole: number;
  sameScreen: number;
  sameParentContext: number;
  historicalSuccess: number;
  visualSimilarity: number;
  duplicatePenalty: number;
  hiddenPenalty: number;
  disabledPenalty: number;
  containerPenalty: number;
  indexOnlyPenalty: number;
  fragileXpathPenalty: number;
}

export interface ScorerThresholds {
  /** Score >= this → auto accept (still subject to verification). */
  autoAccept: number;
  /** Score >= this → proceed with verification before deciding. */
  requireVerification: number;
}

export const DEFAULT_WEIGHTS: ScorerWeights = {
  exactTestId: 40,
  exactResourceId: 40,
  exactAccessibility: 35,
  exactText: 20,
  exactPlaceholder: 20,
  sameRole: 15,
  sameScreen: 15,
  sameParentContext: 15,
  historicalSuccess: 20,
  visualSimilarity: 25,
  duplicatePenalty: -25,
  hiddenPenalty: -40,
  disabledPenalty: -20,
  containerPenalty: -30,
  indexOnlyPenalty: -40,
  fragileXpathPenalty: -30,
};

export const DEFAULT_THRESHOLDS: ScorerThresholds = {
  autoAccept: 85,
  requireVerification: 60,
};

export class ConfidenceScorer {
  constructor(
    private readonly weights: ScorerWeights = DEFAULT_WEIGHTS,
    private readonly thresholds: ScorerThresholds = DEFAULT_THRESHOLDS,
  ) {}

  score(
    intent: ElementIntent,
    candidate: ObservedElement,
    opts: {
      allCandidates?: ObservedElement[];
      screen?: string;
      historicalWinner?: boolean;
    } = {},
  ): MatchScore {
    const reasons: string[] = [];
    const penalties: string[] = [];
    let score = 0;

    const add = (points: number, reason: string) => {
      score += points;
      reasons.push(reason);
    };
    const penalize = (points: number, reason: string) => {
      score += points; // points is already negative
      penalties.push(reason);
    };

    // ── positive signals ──────────────────────────────────────────────────────

    if (candidate.testId) {
      const intentKey = intent.id.split('.').pop() ?? '';
      if (intentKey && normId(candidate.testId) === normId(intentKey)) {
        add(this.weights.exactTestId, 'testId matches intent key');
      } else if (intent.label && normId(candidate.testId).includes(normId(intent.label))) {
        add(Math.floor(this.weights.exactTestId * 0.8), 'testId partially matches label');
      }
    }

    if (candidate.resourceId && intent.label) {
      if (normId(candidate.resourceId).includes(normId(intent.label))) {
        add(this.weights.exactResourceId, 'resourceId matches label');
      }
    }

    if (candidate.accessibilityLabel && intent.label) {
      if (norm(candidate.accessibilityLabel) === norm(intent.label)) {
        add(this.weights.exactAccessibility, 'accessibility label exact match');
      } else if (norm(candidate.accessibilityLabel).includes(norm(intent.label))) {
        add(Math.floor(this.weights.exactAccessibility * 0.7), 'accessibility label partial match');
      }
    }

    if (candidate.text) {
      const target = intent.text ?? intent.label;
      if (target) {
        if (norm(candidate.text) === norm(target)) {
          add(this.weights.exactText, 'text exact match');
        } else if (norm(candidate.text).includes(norm(target))) {
          add(Math.floor(this.weights.exactText * 0.7), 'text partial match');
        }
      }
    }

    if (candidate.placeholder && intent.placeholder) {
      if (norm(candidate.placeholder) === norm(intent.placeholder)) {
        add(this.weights.exactPlaceholder, 'placeholder exact match');
      }
    }

    if (candidate.role && intent.semanticRole) {
      if (norm(candidate.role) === norm(intent.semanticRole)) {
        add(this.weights.sameRole, 'semantic role matches');
      }
    }

    if (opts.screen && intent.screen && norm(opts.screen) === norm(intent.screen)) {
      add(this.weights.sameScreen, 'same screen');
    }

    if (opts.historicalWinner) {
      add(this.weights.historicalSuccess, 'historical success');
    }

    // ── penalties ─────────────────────────────────────────────────────────────

    const duplicates = (opts.allCandidates ?? []).filter(
      (c) =>
        c.id !== candidate.id &&
        c.text != null &&
        candidate.text != null &&
        norm(c.text) === norm(candidate.text),
    ).length;
    if (duplicates > 0) {
      penalize(this.weights.duplicatePenalty, `${duplicates} duplicate(s) with same text`);
    }

    if (!candidate.visible) {
      penalize(this.weights.hiddenPenalty, 'element not visible');
    }

    if (candidate.enabled === false) {
      penalize(this.weights.disabledPenalty, 'element disabled');
    }

    if (
      candidate.childIds != null &&
      candidate.childIds.length > 0 &&
      !candidate.interactive
    ) {
      penalize(this.weights.containerPenalty, 'container element (has children, not interactive)');
    }

    if (candidate.xpath != null && isFragileXpath(candidate.xpath)) {
      penalize(this.weights.fragileXpathPenalty, 'fragile positional xpath');
    }

    return { candidateId: candidate.id, score, reasons, penalties };
  }

  verdict(score: number): 'accept' | 'verify' | 'reject' {
    if (score >= this.thresholds.autoAccept) return 'accept';
    if (score >= this.thresholds.requireVerification) return 'verify';
    return 'reject';
  }

  get thresholdValues(): ScorerThresholds {
    return { ...this.thresholds };
  }
}

/** Normalise for label/text comparison. */
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/** Normalise for id/resourceId/testId comparison (strip separators). */
function normId(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, '');
}

function isFragileXpath(xpath: string): boolean {
  return /\[\d+\]/.test(xpath) || (xpath.split('/').length > 6 && !xpath.includes('@id'));
}
