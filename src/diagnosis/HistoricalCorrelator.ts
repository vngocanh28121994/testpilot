import type { FlakeRecord, FlakeAnalysis, CorrelationContext, EvidenceItem } from './DiagnosisTypes.js';
import { FlakeDetector, type FlakeThresholds } from './FlakeDetector.js';

export interface CorrelationResult {
  /** Evidence items derived from historical records to add to DiagnosisResult. */
  evidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
  /** How many historical records matched the context. */
  matchedRecords: number;
  /** Populated if enough history existed for flake analysis. */
  flakeAnalysis?: FlakeAnalysis;
  /**
   * Confidence delta to apply to the rule engine's initial classification.
   * Positive values increase confidence; negative decrease it.
   */
  confidenceDelta: number;
}

/**
 * Correlates the current failure with stored historical records (plan §68, §70).
 *
 * Used as the second step in the diagnosis pipeline:
 *   rule engine → historical correlator → AI fallback
 *
 * The correlator never changes the classification — it adds evidence and adjusts
 * the confidence so the DiagnosisAgent can merge them into a final result.
 */
export class HistoricalCorrelator {
  private readonly detector: FlakeDetector;

  constructor(thresholds?: FlakeThresholds) {
    this.detector = new FlakeDetector(thresholds);
  }

  correlate(records: FlakeRecord[], ctx: CorrelationContext): CorrelationResult {
    const evidence: EvidenceItem[] = [];
    const counterEvidence: EvidenceItem[] = [];

    // Filter records matching this test/scenario
    const matching = records.filter(
      (r) => r.testId === ctx.testId && r.scenarioId === ctx.scenarioId,
    );
    const matchedRecords = matching.length;

    if (matchedRecords === 0) {
      evidence.push({ type: 'history', value: 'No historical records found for this test+scenario' });
      return { evidence, counterEvidence, matchedRecords, confidenceDelta: 0 };
    }

    // Overall failure stats
    const totalFailed = matching.filter((r) => !r.passed).length;
    const failureRate = totalFailed / matchedRecords;

    evidence.push({
      type: 'history',
      value: `${totalFailed}/${matchedRecords} historical runs failed (${Math.round(failureRate * 100)}% failure rate)`,
    });

    // Same failure signature recurrence
    const sameSignature = matching.filter(
      (r) => !r.passed && r.failureSignature === ctx.failureSignature,
    );
    if (sameSignature.length > 0) {
      evidence.push({
        type: 'signature',
        value: `Same failure signature reproduced ${sameSignature.length}/${matchedRecords} time${sameSignature.length === 1 ? '' : 's'}`,
      });
    }

    // Retry correlation — high retry count in history suggests transient/flaky
    const avgRetries =
      matching.reduce((sum, r) => sum + r.retryCount, 0) / matchedRecords;
    if (avgRetries > 0.5) {
      evidence.push({
        type: 'history',
        value: `Average ${avgRetries.toFixed(1)} retries per run — suggests transient failures`,
      });
    }

    // Device-specific correlation
    if (ctx.device) {
      const onDevice = matching.filter((r) => r.device === ctx.device);
      if (onDevice.length >= 2) {
        const deviceFailRate = onDevice.filter((r) => !r.passed).length / onDevice.length;
        if (deviceFailRate > failureRate * 1.5) {
          evidence.push({
            type: 'device-rate',
            value: `Device-specific failure rate ${Math.round(deviceFailRate * 100)}% vs overall ${Math.round(failureRate * 100)}% — possible device-environment issue`,
          });
        }
      }
    }

    // Environment-specific correlation
    if (ctx.environment) {
      const inEnv = matching.filter((r) => r.environment === ctx.environment);
      if (inEnv.length >= 2) {
        const envFailRate = inEnv.filter((r) => !r.passed).length / inEnv.length;
        if (envFailRate > failureRate * 1.5) {
          evidence.push({
            type: 'environment-rate',
            value: `Environment-specific failure rate ${Math.round(envFailRate * 100)}% vs overall ${Math.round(failureRate * 100)}% — possible environment issue`,
          });
        }
      }
    }

    // Version correlation — failure only on this appVersion
    if (ctx.appVersion) {
      const onVersion = matching.filter((r) => r.appVersion === ctx.appVersion);
      const otherVersions = matching.filter((r) => r.appVersion !== ctx.appVersion && !r.passed);
      if (onVersion.length >= 2 && otherVersions.length === 0) {
        const versionFailRate = onVersion.filter((r) => !r.passed).length / onVersion.length;
        if (versionFailRate > 0.5) {
          evidence.push({
            type: 'history',
            value: `Failures isolated to appVersion=${ctx.appVersion} (${Math.round(versionFailRate * 100)}% rate) — possible regression`,
          });
        }
      }
    }

    // Run flake analysis
    const flakeAnalysis = this.detector.analyze(records, ctx);

    // Counter-evidence: if historically stable, the current failure is suspicious
    if (flakeAnalysis.classification === 'STABLE_PASS' && failureRate < 0.1) {
      counterEvidence.push({
        type: 'history',
        value: `Scenario was historically stable (${Math.round((1 - failureRate) * 100)}% pass rate) — this may be an environment or data issue`,
      });
    }

    // Confidence delta: strong history → more confident; sparse history → less
    let confidenceDelta = 0;
    if (matchedRecords >= 10 && flakeAnalysis.classification !== 'UNKNOWN') {
      confidenceDelta = 0.1; // enough history to be confident
    } else if (matchedRecords < 3) {
      confidenceDelta = -0.1; // sparse history reduces certainty
    }

    // If history strongly contradicts current classification (e.g. consistently stable
    // but classified as FLAKY) reduce confidence more
    if (flakeAnalysis.classification === 'STABLE_PASS' && failureRate < 0.05) {
      confidenceDelta -= 0.15;
    }

    return {
      evidence,
      counterEvidence,
      matchedRecords,
      flakeAnalysis,
      confidenceDelta,
    };
  }
}
