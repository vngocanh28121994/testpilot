import type { Platform, LocatorCandidate } from '../core/types.js';
import type { ElementIntent } from '../discovery/ElementIntent.js';
import type { DiscoveryMethod } from '../discovery/ElementDiscovery.js';

export type RunStatus = 'passed' | 'failed' | 'skipped' | 'blocked';
export type StepStatus = 'passed' | 'failed' | 'skipped';

export type FailureCategory =
  | 'LOCATOR_FAILURE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'ASSERTION_MISMATCH'
  | 'PRODUCT_DEFECT'
  | 'TEST_DATA'
  | 'APP_CRASH'
  | 'ENVIRONMENT_UNAVAILABLE'
  | 'UNKNOWN';

/** Stable, cross-layer representation of a test failure. */
export interface NormalizedFailure {
  category: FailureCategory;
  /** Short machine-readable code within the category. */
  code: string;
  message: string;
  stepId?: string;
  /** ArtifactRef ids captured at failure time. */
  evidenceRefs: string[];
  /**
   * Stable key for history and flaky detection.
   * Format: `CATEGORY:screen=<screen>:intent=<elementId>` — deliberately
   * excludes stack trace so the same logical failure produces the same
   * signature across different runs, builds, and stack depths.
   */
  signature: string;
  /** True when the failure is likely transient and safe to retry. */
  transient?: boolean;
  /** 0..1 confidence in the category classification. */
  confidence?: number;
}

export interface ArtifactRef {
  id: string;
  type: 'screenshot' | 'video' | 'page-source' | 'dom' | 'log' | 'diff' | 'report';
  storageUri: string;
  mimeType: string;
  sizeBytes?: number;
  retentionUntil?: string;
  checksum?: string;
}

export interface DeviceInfo {
  platform: Platform;
  device: string;
  osVersion?: string;
}

/** One step in the discovery pipeline's attempt to locate an element. */
export interface DiscoveryAttempt {
  method: DiscoveryMethod;
  locator?: { strategy: string; value: string };
  confidence?: number;
  outcome: 'found' | 'not-found' | 'failed-verification' | 'error';
  errorMessage?: string;
}

/** Pre-interaction checks the verifier ran before the step executed. */
export interface VerificationResult {
  passed: boolean;
  action: string;
  elementEnabled: boolean;
  elementVisible: boolean;
  elementInteractive: boolean;
  failureReason?: string;
}

/**
 * Evidence-rich result for one step.
 * Artifacts and discovery/verification details are populated only for failed
 * steps to keep passing-step overhead minimal.
 */
export interface StepExecutionResult {
  stepId: string;
  text: string;
  status: StepStatus;
  durationMs: number;

  locatorUsed?: LocatorCandidate;
  elementIntent?: ElementIntent;
  discoveryAttempts?: DiscoveryAttempt[];
  verificationResult?: VerificationResult;

  screenshot?: ArtifactRef;
  pageSource?: ArtifactRef;
  driverLogs?: ArtifactRef;

  error?: NormalizedFailure;
}

/**
 * Complete evidence package for one scenario execution attempt.
 * Designed to be self-contained: a reader needs nothing beyond this
 * struct to understand what happened, why it failed, and what was seen.
 */
export interface ExecutionResult {
  runId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  steps: StepExecutionResult[];
  /** All artifacts collected across the entire run. */
  artifacts: ArtifactRef[];
  device: DeviceInfo;
  /** Top-level failure if the run did not complete normally. */
  error?: NormalizedFailure;
}
