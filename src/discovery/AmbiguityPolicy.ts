/**
 * Ambiguity detection and candidate ranking — G05 (review v5 + v6 §17-20).
 *
 * A high match confidence does NOT imply uniqueness.
 * Two "Confirm" buttons at scores 82 and 80 are ambiguous — choosing the first
 * one automatically is a correctness bug, not a feature.
 *
 * Rules:
 *   confidence < minimumConfidence  → INSUFFICIENT / LOW_CONFIDENCE
 *   top - second < minimumMargin    → AMBIGUOUS (stop, surface to human)
 *   otherwise                       → CLEAR / SELECTED (safe to act autonomously)
 *
 * CandidateRanking exposes the margin explicitly so downstream components can
 * inspect the decision without re-running the ambiguity check.
 *
 * CandidateDecision is a typed discriminated union replacing the raw
 * Candidate | undefined pattern.
 */

export interface AmbiguityPolicy {
  /** Minimum confidence to even consider a candidate. Below this → INSUFFICIENT. */
  minimumConfidence: number;
  /** Top score minus second score must be at least this to avoid AMBIGUOUS. */
  minimumMargin: number;
  /** Maximum number of candidates above threshold for autonomous action. */
  maxCandidatesForAutoAction: number;
}

export const DEFAULT_AMBIGUITY_POLICY: AmbiguityPolicy = {
  minimumConfidence: 60,
  minimumMargin: 10,
  maxCandidatesForAutoAction: 1,
};

export type AmbiguityOutcome =
  | 'CLEAR'         // unique winner above threshold — safe to proceed
  | 'AMBIGUOUS'     // multiple strong candidates — must not auto-act
  | 'INSUFFICIENT'; // best score below minimum — reject entirely

export interface AmbiguityCheckResult {
  outcome: AmbiguityOutcome;
  topScore: number;
  secondScore?: number;
  margin?: number;
  candidatesAboveThreshold: number;
  reason: string;
}

// ── candidate ranking ─────────────────────────────────────────────────────────

/**
 * Ranking metadata for the top candidates — exposed so callers can log the
 * margin without having to reconstruct it from the raw scores array.
 */
export interface CandidateRanking {
  topScore: number;
  secondScore?: number;
  /** topScore − secondScore. Undefined when there is only one candidate. */
  margin?: number;
}

// ── candidate decision ────────────────────────────────────────────────────────

/** Typed result of the candidate selection step — replaces `Candidate | undefined`. */
export type CandidateDecision =
  | { status: 'SELECTED'; topScore: number; secondScore?: number; margin?: number; reason: string }
  | { status: 'AMBIGUOUS'; topScore: number; secondScore: number; margin: number; reason: string }
  | { status: 'LOW_CONFIDENCE'; topScore: number; reason: string }
  | { status: 'NO_MATCH'; reason: string };

/**
 * Convert an AmbiguityCheckResult into the structured CandidateDecision type.
 * Useful for components that need a discriminated union rather than the raw
 * outcome + score fields.
 */
export function toCandidateDecision(result: AmbiguityCheckResult): CandidateDecision {
  switch (result.outcome) {
    case 'CLEAR':
      return {
        status: 'SELECTED',
        topScore: result.topScore,
        secondScore: result.secondScore,
        margin: result.margin,
        reason: result.reason,
      };
    case 'AMBIGUOUS':
      return {
        status: 'AMBIGUOUS',
        topScore: result.topScore,
        secondScore: result.secondScore!,
        margin: result.margin!,
        reason: result.reason,
      };
    case 'INSUFFICIENT':
      if (result.topScore === 0) {
        return { status: 'NO_MATCH', reason: result.reason };
      }
      return { status: 'LOW_CONFIDENCE', topScore: result.topScore, reason: result.reason };
  }
}

// ── ambiguity gate ────────────────────────────────────────────────────────────

/**
 * Run the ambiguity gate on a sorted list of match scores.
 *
 * @param scores   Candidate confidence scores, sorted descending (0..100).
 * @param policy   Policy to evaluate against (default: DEFAULT_AMBIGUITY_POLICY).
 */
export function checkAmbiguity(
  scores: number[],
  policy: AmbiguityPolicy = DEFAULT_AMBIGUITY_POLICY,
): AmbiguityCheckResult {
  if (scores.length === 0) {
    return {
      outcome: 'INSUFFICIENT',
      topScore: 0,
      candidatesAboveThreshold: 0,
      reason: 'No candidates found',
    };
  }

  const topScore = scores[0]!;

  if (topScore < policy.minimumConfidence) {
    return {
      outcome: 'INSUFFICIENT',
      topScore,
      candidatesAboveThreshold: 0,
      reason: `Best score ${topScore} < minimumConfidence ${policy.minimumConfidence}`,
    };
  }

  const aboveThreshold = scores.filter((s) => s >= policy.minimumConfidence);
  const candidatesAboveThreshold = aboveThreshold.length;

  // Too many candidates above threshold
  if (candidatesAboveThreshold > policy.maxCandidatesForAutoAction) {
    const secondScore = scores[1]!;
    const margin = topScore - secondScore;

    if (margin < policy.minimumMargin) {
      return {
        outcome: 'AMBIGUOUS',
        topScore,
        secondScore,
        margin,
        candidatesAboveThreshold,
        reason:
          `${candidatesAboveThreshold} candidates above threshold; ` +
          `margin ${margin} < required ${policy.minimumMargin} — cannot choose autonomously`,
      };
    }

    // Margin is sufficient — treat as clear despite multiple candidates above threshold
    return {
      outcome: 'CLEAR',
      topScore,
      secondScore,
      margin,
      candidatesAboveThreshold,
      reason:
        `Top score ${topScore}, second ${secondScore}, margin ${margin} ≥ ${policy.minimumMargin} — clear winner`,
    };
  }

  return {
    outcome: 'CLEAR',
    topScore,
    candidatesAboveThreshold,
    reason: `Single candidate at ${topScore} ≥ ${policy.minimumConfidence}`,
  };
}
