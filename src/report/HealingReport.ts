/**
 * Healing report builder — item 46 (plan §71, §75).
 *
 * Aggregates HealingResult records from all steps across all scenarios
 * into the HealingReport sub-section of AgentRunReport.
 *
 * Guarded by the same evidence-only principle as FailureDiagnosisAgent:
 * no raw chain-of-thought enters the report, only structured evidence items.
 */

import type { HealingResult } from '../execution/HealingTypes.js';
import type { HealingReport, HealingReportEntry } from './ReportTypes.js';

// ── context wrapper ───────────────────────────────────────────────────────────

/**
 * Pairs a HealingResult with the execution context needed for the report.
 * The executor must supply these fields; they are not on HealingResult itself.
 */
export interface HealingContext {
  result: HealingResult;
  scenarioId: string;
  testCaseId?: string;
  stepText: string;
  /** Human-readable label of the element (from ElementIntent.label). */
  elementLabel?: string;
  /** Total number of healing attempts made for this step (>=1). */
  attempts: number;
}

// ── builder ───────────────────────────────────────────────────────────────────

/**
 * Build a HealingReport from a flat list of healing context records.
 */
export function buildHealingReport(contexts: HealingContext[]): HealingReport {
  const entries: HealingReportEntry[] = contexts.map(toEntry);

  const healedCount   = entries.filter((e) => e.healed).length;
  const failedCount   = entries.filter((e) => !e.healed).length;
  const totalAttempts = entries.length;
  const successRate   = totalAttempts > 0 ? healedCount / totalAttempts : 0;

  return { totalAttempts, healedCount, failedCount, successRate, entries };
}

/** Empty report for runs with no healing activity. */
export function emptyHealingReport(): HealingReport {
  return { totalAttempts: 0, healedCount: 0, failedCount: 0, successRate: 0, entries: [] };
}

/**
 * Merge a new healing context into an existing HealingReport in place.
 * Safe to call incrementally during a run.
 */
export function appendHealingContext(
  report: HealingReport,
  ctx: HealingContext,
): HealingReport {
  const entries = [...report.entries, toEntry(ctx)];
  const healedCount = entries.filter((e) => e.healed).length;
  return {
    totalAttempts: entries.length,
    healedCount,
    failedCount: entries.length - healedCount,
    successRate: entries.length > 0 ? healedCount / entries.length : 0,
    entries,
  };
}

/** Human-readable healing summary for logs and agent events. */
export function formatHealingReport(report: HealingReport): string {
  if (report.totalAttempts === 0) return 'No healing attempts this run.';

  const lines: string[] = [
    `Healing: ${report.healedCount}/${report.totalAttempts} healed ` +
    `(${Math.round(report.successRate * 100)}% success rate)`,
  ];

  for (const e of report.entries) {
    const tag = e.healed ? '✓' : '✗';
    const method = e.method ? ` [${e.method}]` : '';
    const conf = e.confidence != null
      ? ` confidence=${(e.confidence * 100).toFixed(0)}%`
      : '';
    lines.push(`  ${tag} ${e.scenarioId} / "${e.stepText}"${method}${conf}`);
    if (e.healed && e.oldLocator && e.newLocator) {
      lines.push(`    old: ${e.oldLocator}`);
      lines.push(`    new: ${e.newLocator}`);
    }
    if (!e.healed && e.evidence.length > 0) {
      lines.push(`    reason: ${e.evidence.map((ev) => ev.value).join('; ')}`);
    }
  }

  return lines.join('\n');
}

// ── internals ─────────────────────────────────────────────────────────────────

function toEntry(ctx: HealingContext): HealingReportEntry {
  const r = ctx.result;
  return {
    scenarioId: ctx.scenarioId,
    testCaseId: ctx.testCaseId,
    stepText: ctx.stepText,
    elementLabel: ctx.elementLabel,
    attempts: ctx.attempts,
    healed: r.healed,
    method: r.method,
    oldLocator: r.oldLocator ? formatLocator(r.oldLocator) : undefined,
    newLocator: r.newLocator ? formatLocator(r.newLocator) : undefined,
    confidence: r.confidence / 100,  // HealingResult uses 0..100; report uses 0..1
    antiRegressionPassed: r.antiRegressionPassed,
    evidence: (r.evidence ?? []).map((value) => ({ type: 'rule' as const, value })),
  };
}

function formatLocator(loc: { strategy: string; value: string }): string {
  return `${loc.strategy}:${loc.value}`;
}
