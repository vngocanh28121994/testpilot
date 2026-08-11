/**
 * Ambiguity detection — G05 (review v5).
 *
 * A high match confidence does NOT imply uniqueness.
 * Two "Confirm" buttons at scores 82 and 80 are ambiguous — choosing the first
 * one automatically is a correctness bug, not a feature.
 *
 * Rules:
 *   confidence < minimumConfidence  → INSUFFICIENT (reject outright)
 *   top - second < minimumMargin    → AMBIGUOUS (stop, surface to human)
 *   otherwise                       → CLEAR (safe to act autonomously)
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
