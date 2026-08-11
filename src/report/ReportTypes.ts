/**
 * Shared types for P2 Reporting — item 44 (plan §75).
 *
 * AgentRunReport is the single top-level container written at the end of every
 * agentic run. All sub-reports (failures, healing, devices, traceability,
 * AI metrics, executive summary) are nested here so a consumer never needs to
 * read multiple files to reconstruct the picture.
 *
 * Chain of custody:
 *   Requirement → TestCase → Scenario → AWS Run → Evidence → Report
 */

import type { AgentEvent, AgentBudget } from '../agent/AgentTypes.js';
import type { ArtifactRef, DeviceInfo, RunStatus } from '../execution/ExecutionTypes.js';
import type { DiagnosisClassification, RecommendedAction, EvidenceItem } from '../diagnosis/DiagnosisTypes.js';
import type { FailureCategory } from '../execution/ExecutionTypes.js';
import type { HealingMethod } from '../execution/HealingTypes.js';
import type { AgentPhase } from '../agent/AgentTypes.js';

export type { RunStatus };

// ── per-failure detail ────────────────────────────────────────────────────────

export interface FailureReport {
  testCaseId: string;
  scenarioId: string;
  /** Step text that failed. */
  stepText: string;
  category: FailureCategory;
  classification: DiagnosisClassification;
  /** Diagnosis confidence 0–1. */
  confidence: number;
  recommendedAction: RecommendedAction;
  evidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
  /** Stable failure signature (CATEGORY:screen=X:intent=Y). */
  signature: string;
  /** Screenshots, logs, DOM captured at failure time. */
  artifacts: ArtifactRef[];
}

// ── per-device summary ────────────────────────────────────────────────────────

export interface DeviceExecutionReport {
  device: DeviceInfo;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  healed: number;
  durationMs: number;
  artifacts: ArtifactRef[];
}

// ── healing entry ─────────────────────────────────────────────────────────────

export interface HealingReportEntry {
  scenarioId: string;
  testCaseId?: string;
  stepText: string;
  /** Human-readable label of the element that was healed. */
  elementLabel?: string;
  attempts: number;
  healed: boolean;
  method?: HealingMethod;
  /** Previous locator strategy:value (redacted if it contained credentials). */
  oldLocator?: string;
  newLocator?: string;
  confidence?: number;
  antiRegressionPassed?: boolean;
  evidence: EvidenceItem[];
}

export interface HealingReport {
  totalAttempts: number;
  healedCount: number;
  failedCount: number;
  /** Fraction of attempts that succeeded: 0–1. */
  successRate: number;
  entries: HealingReportEntry[];
}

// ── traceability chain ────────────────────────────────────────────────────────

export interface TraceabilityRecord {
  requirementId: string;
  testCaseId: string;
  scenarioId: string;
  /** Path to the .feature file (relative to project root). */
  gherkinPath?: string;
  awsRunArn?: string;
  status: RunStatus;
  /** Screenshots / video / logs attached to this scenario's AWS run. */
  evidence: ArtifactRef[];
}

// ── AI metrics ────────────────────────────────────────────────────────────────

export interface AiCallRecord {
  phase: AgentPhase;
  type: 'semantic' | 'vision' | 'diagnosis' | 'device-selection' | 'step-wording';
  durationMs?: number;
  succeeded: boolean;
  /** Token estimate when available from the provider. */
  estimatedTokens?: number;
}

export interface AiMetricsReport {
  totalAiCalls: number;
  totalVisionCalls: number;
  budgetUsed: { aiCalls: number; visionCalls: number };
  budgetLimit: { maxAiCalls: number; maxVisionCalls: number };
  budgetUtilizationPct: { ai: number; vision: number };
  callsByPhase: Array<{ phase: AgentPhase; count: number }>;
  estimatedTokens: number;
}

// ── executive summary ─────────────────────────────────────────────────────────

export interface ExecutiveReport {
  /** Fraction of scenarios that passed (including healed): 0–1. */
  passRate: number;
  /** Fraction of failures resolved by self-healing: 0–1. */
  healRate: number;
  /** Requirement coverage score: 0–100 (from computeCoverageReport). */
  coverageScore: number;
  requirementsCovered: number;
  requirementsTotal: number;
  /** Top-risk descriptions from RequirementArtifact.risks. */
  topRisks: string[];
  /** Actionable suggestions derived from recommendedActions across all failures. */
  recommendedActions: string[];
  generatedAt: string;
}

// ── top-level report container (plan §75) ────────────────────────────────────

export interface AgentRunReport {
  /** Matches AgentRun.id. */
  runId: string;
  startedAt: string;
  endedAt?: string;

  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    healed: number;
    flaky: number;
  };

  coverage: {
    /** Number of unique requirements exercised. */
    requirements: number;
    testCases: number;
    scenarios: number;
    executed: number;
  };

  failures: FailureReport[];
  healing: HealingReport;
  devices: DeviceExecutionReport[];
  traceability: TraceabilityRecord[];

  /** Chronological agent event log (decision summaries only — no raw CoT). */
  agentEvents: AgentEvent[];

  /** All artifact refs collected during the run. */
  artifacts: ArtifactRef[];

  aiMetrics: AiMetricsReport;
  executive: ExecutiveReport;

  /** Budget config in effect for this run. */
  budget: AgentBudget;
}

// ── builder helper ────────────────────────────────────────────────────────────

/** Construct an empty summary block for accumulation. */
export function emptySummary(): AgentRunReport['summary'] {
  return { total: 0, passed: 0, failed: 0, skipped: 0, healed: 0, flaky: 0 };
}

/** Construct an empty coverage block for accumulation. */
export function emptyCoverage(): AgentRunReport['coverage'] {
  return { requirements: 0, testCases: 0, scenarios: 0, executed: 0 };
}
