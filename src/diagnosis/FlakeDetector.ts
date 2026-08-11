import type { FlakeRecord, FlakeAnalysis, FlakeClassification, CorrelationContext } from './DiagnosisTypes.js';

/** Thresholds for statistical classification (plan §70). */
export interface FlakeThresholds {
  /** Minimum runs before any classification is meaningful (never flaky on 1 run). */
  minRuns: number;
  /** failureRate above this → STABLE_FAIL. */
  stableFailAt: number;
  /** failureRate below this → STABLE_PASS. */
  stablePassAt: number;
  /** Device-specific rate must exceed global rate by this factor to be ENVIRONMENTAL. */
  deviceRatioThreshold: number;
  /** Environment-specific rate must exceed global rate by this factor to be ENVIRONMENTAL. */
  environmentRatioThreshold: number;
  /** alternationCount / totalRuns above this → evidence of flakiness. */
  alternationRatioThreshold: number;
  /** Number of recent runs to compute recentFailureRate. */
  recentWindow: number;
}

export const DEFAULT_THRESHOLDS: FlakeThresholds = {
  minRuns: 2,
  stableFailAt: 0.9,
  stablePassAt: 0.1,
  deviceRatioThreshold: 2.0,
  environmentRatioThreshold: 2.0,
  alternationRatioThreshold: 0.3,
  recentWindow: 10,
};

/**
 * Statistical flaky-test detector (plan §70).
 *
 * Classification is NEVER based on a single run.  Only after `minRuns` records
 * exist can any meaningful verdict be reached.
 */
export class FlakeDetector {
  constructor(private readonly thresholds: FlakeThresholds = DEFAULT_THRESHOLDS) {}

  /**
   * Classify a scenario's flakiness given its historical records and the
   * context of the current failure.
   */
  analyze(records: FlakeRecord[], ctx: CorrelationContext): FlakeAnalysis {
    // Filter to records for this test+scenario (cross-device/env)
    const matching = records.filter(
      (r) => r.testId === ctx.testId && r.scenarioId === ctx.scenarioId,
    );

    const totalRuns = matching.length;

    if (totalRuns < this.thresholds.minRuns) {
      return {
        classification: 'UNKNOWN',
        totalRuns,
        failureRate: totalRuns === 0 ? 0 : computeFailureRate(matching),
        recentFailureRate: 0,
        consecutiveFailures: 0,
        alternationCount: 0,
        confidence: 0.2,
        summary: `Insufficient history (${totalRuns} run${totalRuns === 1 ? '' : 's'} — need at least ${this.thresholds.minRuns})`,
      };
    }

    // Sort oldest→newest for temporal analysis
    const sorted = [...matching].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const failureRate = computeFailureRate(sorted);
    const recentWindow = this.thresholds.recentWindow;
    const recentRecords = sorted.slice(-recentWindow);
    const recentFailureRate = computeFailureRate(recentRecords);
    const consecutiveFailures = trailingConsecutiveFailures(sorted);
    const alternationCount = countAlternations(sorted);

    // Device-specific rate
    let deviceSpecificRate: number | undefined;
    if (ctx.device) {
      const onDevice = sorted.filter((r) => r.device === ctx.device);
      if (onDevice.length >= 2) deviceSpecificRate = computeFailureRate(onDevice);
    }

    // Environment-specific rate
    let environmentSpecificRate: number | undefined;
    if (ctx.environment) {
      const inEnv = sorted.filter((r) => r.environment === ctx.environment);
      if (inEnv.length >= 2) environmentSpecificRate = computeFailureRate(inEnv);
    }

    const { classification, confidence, summary } = classify({
      failureRate,
      recentFailureRate,
      deviceSpecificRate,
      environmentSpecificRate,
      consecutiveFailures,
      alternationCount,
      totalRuns,
      thresholds: this.thresholds,
    });

    return {
      classification,
      totalRuns,
      failureRate,
      recentFailureRate,
      deviceSpecificRate,
      environmentSpecificRate,
      consecutiveFailures,
      alternationCount,
      confidence,
      summary,
    };
  }
}

// ── classification logic ──────────────────────────────────────────────────────

interface ClassifyInput {
  failureRate: number;
  recentFailureRate: number;
  deviceSpecificRate?: number;
  environmentSpecificRate?: number;
  consecutiveFailures: number;
  alternationCount: number;
  totalRuns: number;
  thresholds: FlakeThresholds;
}

interface ClassifyOutput {
  classification: FlakeClassification;
  confidence: number;
  summary: string;
}

function classify(i: ClassifyInput): ClassifyOutput {
  const t = i.thresholds;

  // Consistently failing — not flaky, just broken
  if (i.failureRate >= t.stableFailAt) {
    return {
      classification: 'STABLE_FAIL',
      confidence: 0.9,
      summary: `Consistently failing (${pct(i.failureRate)} failure rate over ${i.totalRuns} runs)`,
    };
  }

  // Consistently passing
  if (i.failureRate < t.stablePassAt) {
    return {
      classification: 'STABLE_PASS',
      confidence: 0.9,
      summary: `Consistently passing (${pct(i.failureRate)} failure rate over ${i.totalRuns} runs)`,
    };
  }

  // Device-specific isolation → ENVIRONMENTAL
  if (
    i.deviceSpecificRate !== undefined &&
    i.deviceSpecificRate >= t.stableFailAt &&
    i.deviceSpecificRate >= i.failureRate * t.deviceRatioThreshold
  ) {
    return {
      classification: 'ENVIRONMENTAL',
      confidence: 0.8,
      summary:
        `Device-specific failure rate ${pct(i.deviceSpecificRate)} vs global ${pct(i.failureRate)}` +
        ` — likely device-specific environment issue`,
    };
  }

  // Environment-specific isolation → ENVIRONMENTAL
  if (
    i.environmentSpecificRate !== undefined &&
    i.environmentSpecificRate >= t.stableFailAt &&
    i.environmentSpecificRate >= i.failureRate * t.environmentRatioThreshold
  ) {
    return {
      classification: 'ENVIRONMENTAL',
      confidence: 0.75,
      summary:
        `Environment-specific failure rate ${pct(i.environmentSpecificRate)} vs global ${pct(i.failureRate)}` +
        ` — likely infrastructure-specific issue`,
    };
  }

  // High alternation ratio → FLAKY
  const alternationRatio = i.totalRuns > 0 ? i.alternationCount / i.totalRuns : 0;
  if (alternationRatio >= t.alternationRatioThreshold) {
    return {
      classification: 'FLAKY',
      confidence: 0.8,
      summary:
        `High pass/fail alternation (${i.alternationCount} transitions in ${i.totalRuns} runs, ${pct(i.failureRate)} failure rate)`,
    };
  }

  // Intermediate failure rate without clear pattern → FLAKY with lower confidence
  if (i.failureRate >= t.stablePassAt && i.failureRate < t.stableFailAt) {
    const confidence = 0.5 + 0.2 * alternationRatio / t.alternationRatioThreshold;
    return {
      classification: 'FLAKY',
      confidence: Math.min(confidence, 0.7),
      summary:
        `Intermittent failures (${pct(i.failureRate)} failure rate, ${i.alternationCount} alternations in ${i.totalRuns} runs)`,
    };
  }

  return {
    classification: 'UNKNOWN',
    confidence: 0.3,
    summary: `No clear pattern in ${i.totalRuns} runs (${pct(i.failureRate)} failure rate)`,
  };
}

// ── statistics helpers ────────────────────────────────────────────────────────

function computeFailureRate(records: FlakeRecord[]): number {
  if (records.length === 0) return 0;
  return records.filter((r) => !r.passed).length / records.length;
}

/** Count trailing consecutive failures (most-recent end of sorted array). */
function trailingConsecutiveFailures(sorted: FlakeRecord[]): number {
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (!sorted[i]!.passed) count++;
    else break;
  }
  return count;
}

/** Count pass→fail or fail→pass transitions in time order. */
function countAlternations(sorted: FlakeRecord[]): number {
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.passed !== sorted[i - 1]!.passed) count++;
  }
  return count;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
