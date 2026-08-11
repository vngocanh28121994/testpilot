/**
 * AI metrics builder — item 47 (plan §51).
 *
 * Aggregates AI and vision call counts from AgentEvents and computes
 * budget utilization. Enables tracking of cost and AI dependency across runs.
 *
 * No LLM is called here — this is purely a metrics aggregation layer.
 */

import type { AgentEvent, AgentBudget } from '../agent/AgentTypes.js';
import type { AiMetricsReport, AiCallRecord } from './ReportTypes.js';
import { DEFAULT_AGENT_BUDGET } from '../agent/AgentTypes.js';

// ── event type detection ──────────────────────────────────────────────────────

const AI_CALL_TYPES: AiCallRecord['type'][] = [
  'semantic',
  'vision',
  'diagnosis',
  'device-selection',
  'step-wording',
];

/**
 * Detect the AI call type from an AgentEvent's message string.
 * Returns null when the event is not an AI call.
 */
function detectAiCallType(event: AgentEvent): AiCallRecord['type'] | null {
  const msg = event.action.toLowerCase();

  if (msg.includes('vision') || msg.includes('screenshot')) return 'vision';
  if (msg.includes('semantic') || msg.includes('llm') || msg.includes('language model')) return 'semantic';
  if (msg.includes('diagnos')) return 'diagnosis';
  if (msg.includes('device select') || msg.includes('device recommendation')) return 'device-selection';
  if (msg.includes('step wording') || msg.includes('rewording')) return 'step-wording';

  return null;
}

// ── explicit call record accumulation ────────────────────────────────────────

/**
 * Build AiMetricsReport from an explicit list of AiCallRecords.
 * Use this when the executor tracks AI calls directly (preferred path).
 */
export function buildAiMetrics(
  records: AiCallRecord[],
  budget: AgentBudget = DEFAULT_AGENT_BUDGET,
): AiMetricsReport {
  const totalAiCalls     = records.filter((r) => r.type !== 'vision').length;
  const totalVisionCalls = records.filter((r) => r.type === 'vision').length;
  const estimatedTokens  = records.reduce((s, r) => s + (r.estimatedTokens ?? 0), 0);

  const phaseMap = new Map<string, number>();
  for (const r of records) {
    phaseMap.set(r.phase, (phaseMap.get(r.phase) ?? 0) + 1);
  }

  const callsByPhase = [...phaseMap.entries()]
    .map(([phase, count]) => ({ phase: phase as AiCallRecord['phase'], count }))
    .sort((a, b) => b.count - a.count);

  const maxAiCalls     = budget.maxAiCalls;
  const maxVisionCalls = budget.maxVisionCalls;

  return {
    totalAiCalls,
    totalVisionCalls,
    budgetUsed: { aiCalls: totalAiCalls, visionCalls: totalVisionCalls },
    budgetLimit: { maxAiCalls, maxVisionCalls },
    budgetUtilizationPct: {
      ai:     maxAiCalls     > 0 ? Math.round((totalAiCalls     / maxAiCalls)     * 100) : 0,
      vision: maxVisionCalls > 0 ? Math.round((totalVisionCalls / maxVisionCalls) * 100) : 0,
    },
    callsByPhase,
    estimatedTokens,
  };
}

/**
 * Derive AiCallRecords from AgentEvents by heuristic message inspection.
 * Fallback for callers that did not instrument explicit call tracking.
 */
export function inferAiCallRecords(events: AgentEvent[]): AiCallRecord[] {
  const records: AiCallRecord[] = [];

  for (const ev of events) {
    const type = detectAiCallType(ev);
    if (!type) continue;
    records.push({
      phase: ev.phase,
      type,
      succeeded: ev.status === 'completed',
    });
  }

  return records;
}

/**
 * Build AiMetricsReport from AgentEvents (heuristic inference path).
 * Prefer `buildAiMetrics(records, budget)` when call records are available.
 */
export function buildAiMetricsFromEvents(
  events: AgentEvent[],
  budget: AgentBudget = DEFAULT_AGENT_BUDGET,
): AiMetricsReport {
  return buildAiMetrics(inferAiCallRecords(events), budget);
}

/** Human-readable AI metrics summary for agent event logs. */
export function formatAiMetrics(m: AiMetricsReport): string {
  const lines = [
    `AI calls: ${m.totalAiCalls}/${m.budgetLimit.maxAiCalls} (${m.budgetUtilizationPct.ai}% of budget)`,
    `Vision calls: ${m.totalVisionCalls}/${m.budgetLimit.maxVisionCalls} (${m.budgetUtilizationPct.vision}% of budget)`,
  ];

  if (m.estimatedTokens > 0) {
    lines.push(`Estimated tokens: ${m.estimatedTokens.toLocaleString()}`);
  }

  if (m.callsByPhase.length > 0) {
    const byPhase = m.callsByPhase.map((p) => `${p.phase}×${p.count}`).join(', ');
    lines.push(`By phase: ${byPhase}`);
  }

  return lines.join('\n');
}

/** Empty metrics for runs with no AI calls. */
export function emptyAiMetrics(budget: AgentBudget = DEFAULT_AGENT_BUDGET): AiMetricsReport {
  return buildAiMetrics([], budget);
}

// Re-export so callers don't need a separate import for the type.
export type { AiCallRecord };
export { AI_CALL_TYPES };
