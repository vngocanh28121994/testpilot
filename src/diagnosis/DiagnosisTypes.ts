/**
 * Shared types for P1 Diagnosis (plan sections 68–70).
 *
 * DiagnosisClassification overlaps with FailureCategory but is intentionally
 * separate: the rule engine can promote/demote a category after seeing history
 * (e.g. LOCATOR_FAILURE that keeps happening → AUTOMATION_DEFECT).
 */

export type DiagnosisClassification =
  | 'PRODUCT_DEFECT'
  | 'LOCATOR_FAILURE'
  | 'AUTOMATION_DEFECT'
  | 'TEST_DATA'
  | 'ENVIRONMENT'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'FLAKY'
  | 'UNKNOWN';

export type RecommendedAction =
  | 'SELF_HEAL'         // LOCATOR_FAILURE → attempt auto-healing
  | 'CREATE_DEFECT'     // PRODUCT_DEFECT → raise bug
  | 'FIX_TEST'          // AUTOMATION_DEFECT | TEST_DATA → fix test
  | 'CHECK_ENVIRONMENT' // ENVIRONMENT | NETWORK → investigate infra
  | 'RETRY'             // transient TIMEOUT | FLAKY (low rate) → safe retry
  | 'INVESTIGATE'       // UNKNOWN → manual investigation needed
  | 'MONITOR';          // trending flaky — watch, do not act yet

export type EvidenceType =
  | 'assertion'
  | 'api'
  | 'history'
  | 'locator'
  | 'screenshot'
  | 'log'
  | 'signature'
  | 'flake-rate'
  | 'device-rate'
  | 'environment-rate'
  | 'rule';

export interface EvidenceItem {
  type: EvidenceType;
  value: string;
}

/** Structured diagnosis result — matches plan §69 Evidence Matrix. */
export interface DiagnosisResult {
  classification: DiagnosisClassification;
  /** 0..1 confidence in the classification. */
  confidence: number;
  evidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
  recommendedAction: RecommendedAction;
  /** Populated when the historical correlator ran and produced a flake analysis. */
  flakeAnalysis?: FlakeAnalysis;
}

// ── Flake detection types (plan §70) ──────────────────────────────────────────

export type FlakeClassification =
  | 'STABLE_PASS'
  | 'STABLE_FAIL'
  | 'FLAKY'
  | 'ENVIRONMENTAL'
  | 'UNKNOWN';

/**
 * One recorded execution of a test scenario.
 * Tracks all dimensions that affect flakiness (device, OS, version, build, env).
 */
export interface FlakeRecord {
  testId: string;
  scenarioId: string;
  device: string;
  os: string;
  appVersion: string;
  build: string;
  environment: string;
  /** Stable failure signature (same format as NormalizedFailure.signature). */
  failureSignature: string;
  durationMs: number;
  retryCount: number;
  passed: boolean;
  timestamp: string;
}

export interface FlakeAnalysis {
  classification: FlakeClassification;
  totalRuns: number;
  failureRate: number;
  /** Failure rate over the last `recentWindow` runs (default 10). */
  recentFailureRate: number;
  /** Failure rate on the specific device, if computable. */
  deviceSpecificRate?: number;
  /** Failure rate in the specific environment, if computable. */
  environmentSpecificRate?: number;
  /** Count of trailing consecutive failures at the end of the time-sorted records. */
  consecutiveFailures: number;
  /** Number of pass↔fail transitions in time order. */
  alternationCount: number;
  /** 0..1 confidence in the FlakeClassification. */
  confidence: number;
  summary: string;
}

/** Dimensions used to query historical records for correlation. */
export interface CorrelationContext {
  testId: string;
  scenarioId: string;
  device?: string;
  os?: string;
  appVersion?: string;
  build?: string;
  environment?: string;
  failureSignature: string;
}
