import type { NormalizedFailure } from '../execution/ExecutionTypes.js';
import type { ExecutionResult } from '../execution/ExecutionTypes.js';
import type {
  DiagnosisResult,
  DiagnosisClassification,
  EvidenceItem,
  FlakeRecord,
  CorrelationContext,
  RecommendedAction,
} from './DiagnosisTypes.js';
import { DiagnosisRuleEngine } from './DiagnosisRuleEngine.js';
import { HistoricalCorrelator } from './HistoricalCorrelator.js';
import type { FlakeThresholds } from './FlakeDetector.js';

export interface DiagnosisInput {
  failure: NormalizedFailure;
  /** Full execution context, used to enrich evidence (screenshots, API logs, etc.). */
  executionResult?: ExecutionResult;
  /** Historical records for flaky detection and correlation. */
  history?: FlakeRecord[];
  /** Dimensional context for historical lookup. */
  correlationCtx?: CorrelationContext;
}

/** Pluggable AI fallback — used only when rule+history confidence is insufficient. */
export interface AiDiagnosisProvider {
  diagnose(input: DiagnosisInput, ruleResult: DiagnosisResult): Promise<DiagnosisResult>;
}

export interface FailureDiagnosisAgentOptions {
  /** Confidence threshold below which the AI fallback is invoked (default 0.6). */
  aiConfidenceThreshold?: number;
  flakeThresholds?: FlakeThresholds;
  aiProvider?: AiDiagnosisProvider;
}

/**
 * Orchestrates the failure diagnosis pipeline (plan §68):
 *
 *   1. DiagnosisRuleEngine  — deterministic, no LLM
 *   2. HistoricalCorrelator — adds flake evidence, adjusts confidence
 *   3. AiDiagnosisProvider  — called only when confidence < threshold
 *
 * Returns a merged DiagnosisResult with evidence from all stages that ran.
 */
export class FailureDiagnosisAgent {
  private readonly ruleEngine: DiagnosisRuleEngine;
  private readonly correlator: HistoricalCorrelator;
  private readonly aiConfidenceThreshold: number;
  private readonly aiProvider?: AiDiagnosisProvider;

  constructor(opts: FailureDiagnosisAgentOptions = {}) {
    this.ruleEngine = new DiagnosisRuleEngine();
    this.correlator = new HistoricalCorrelator(opts.flakeThresholds);
    this.aiConfidenceThreshold = opts.aiConfidenceThreshold ?? 0.6;
    this.aiProvider = opts.aiProvider;
  }

  async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
    // ── Step 1: Deterministic rule engine ────────────────────────────────────
    let result = this.ruleEngine.diagnose(input.failure);

    // ── Step 2: Execution-result evidence enrichment ──────────────────────────
    if (input.executionResult) {
      result = enrichFromExecution(result, input.executionResult, input.failure);
    }

    // ── Step 3: Historical correlation ────────────────────────────────────────
    if (input.history && input.correlationCtx) {
      const correlation = this.correlator.correlate(input.history, input.correlationCtx);

      const mergedEvidence = [...result.evidence, ...correlation.evidence];
      const mergedCounter = [...result.counterEvidence, ...correlation.counterEvidence];
      const adjustedConfidence = clamp(result.confidence + correlation.confidenceDelta);

      // If history says FLAKY and rule engine didn't already say so, upgrade
      const classification =
        correlation.flakeAnalysis?.classification === 'FLAKY' &&
        result.classification !== 'LOCATOR_FAILURE' &&
        result.classification !== 'PRODUCT_DEFECT'
          ? 'FLAKY'
          : result.classification;

      const recommendedAction = classification !== result.classification
        ? 'RETRY'
        : result.recommendedAction;

      result = {
        ...result,
        classification,
        confidence: adjustedConfidence,
        evidence: mergedEvidence,
        counterEvidence: mergedCounter,
        recommendedAction,
        flakeAnalysis: correlation.flakeAnalysis,
      };
    }

    // ── Step 4: AI fallback (only when confidence is insufficient) ────────────
    if (result.confidence < this.aiConfidenceThreshold && this.aiProvider) {
      const aiResult = await this.aiProvider.diagnose(input, result);
      result = mergeWithAi(result, aiResult);
    }

    return result;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function enrichFromExecution(
  result: DiagnosisResult,
  execution: ExecutionResult,
  failure: NormalizedFailure,
): DiagnosisResult {
  const extra: EvidenceItem[] = [];

  // Artifact references as evidence
  if (execution.artifacts.length > 0) {
    const screenshots = execution.artifacts.filter((a) => a.type === 'screenshot');
    if (screenshots.length > 0) {
      extra.push({ type: 'screenshot', value: `${screenshots.length} screenshot(s) captured at failure` });
    }
    const logs = execution.artifacts.filter((a) => a.type === 'log');
    if (logs.length > 0) {
      extra.push({ type: 'log', value: `${logs.length} driver log(s) available for inspection` });
    }
  }

  // Step-level evidence
  const failedSteps = execution.steps.filter((s) => s.status === 'failed');
  if (failedSteps.length > 0) {
    extra.push({
      type: 'history',
      value: `${failedSteps.length} step(s) failed in this run`,
    });
  }

  return { ...result, evidence: [...result.evidence, ...extra] };
}

/**
 * Merge rule+history result with the AI result.
 * AI evidence is appended; AI classification wins only when it has higher confidence.
 */
function mergeWithAi(base: DiagnosisResult, ai: DiagnosisResult): DiagnosisResult {
  const aiEvidence: EvidenceItem[] = ai.evidence.map((e) => ({
    ...e,
    value: `[ai] ${e.value}`,
  }));

  const useAiClassification = ai.confidence > base.confidence;

  return {
    classification: useAiClassification ? ai.classification : base.classification,
    confidence: Math.max(base.confidence, ai.confidence),
    evidence: [...base.evidence, ...aiEvidence],
    counterEvidence: [...base.counterEvidence, ...ai.counterEvidence],
    recommendedAction: useAiClassification ? ai.recommendedAction : base.recommendedAction,
    flakeAnalysis: base.flakeAnalysis ?? ai.flakeAnalysis,
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
