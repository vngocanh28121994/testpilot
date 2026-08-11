/**
 * Executive report builder — item 48 (plan §46, §75).
 *
 * Derives a high-level summary from the full AgentRunReport — pass rate,
 * heal rate, requirement coverage, top risks, and prioritised actions.
 * Aimed at QA managers and product owners who need a one-page view.
 *
 * No raw AI reasoning appears here. All inputs are structured data already
 * present in AgentRunReport.
 */

import type { AgentRunReport, ExecutiveReport, FailureReport } from './ReportTypes.js';
import type { RecommendedAction } from '../diagnosis/DiagnosisTypes.js';

// ── builder ───────────────────────────────────────────────────────────────────

/**
 * Derive an ExecutiveReport from a completed AgentRunReport.
 * Call this as the last step of report assembly.
 */
export function buildExecutiveReport(report: AgentRunReport): ExecutiveReport {
  const { summary, coverage, failures, healing, traceability } = report;

  // Pass rate: (passed + healed) / total
  const effectivePasses = summary.passed + summary.healed;
  const passRate = summary.total > 0 ? effectivePasses / summary.total : 0;

  // Heal rate: healed / (healed + failed) — fraction of failures self-healed
  const healableAttempts = summary.healed + summary.failed;
  const healRate = healableAttempts > 0 ? summary.healed / healableAttempts : 0;

  // Requirement coverage
  const requirementsTotal   = coverage.requirements;
  const requirementsCovered = countCoveredRequirements(traceability);
  const coverageScore       = requirementsTotal > 0
    ? Math.round((requirementsCovered / requirementsTotal) * 100)
    : 0;

  // Top risks — derive from failure classifications (most impactful first)
  const topRisks = deriveTopRisks(failures);

  // Recommended actions — de-duplicated, priority-sorted
  const recommendedActions = deriveRecommendedActions(failures, healing.healedCount, summary);

  return {
    passRate,
    healRate,
    coverageScore,
    requirementsCovered,
    requirementsTotal,
    topRisks,
    recommendedActions,
    generatedAt: new Date().toISOString(),
  };
}

/** Human-readable executive summary for stakeholder communication. */
export function formatExecutiveReport(exec: ExecutiveReport): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const lines = [
    '## Executive Summary',
    '',
    `- **Pass rate**: ${pct(exec.passRate)} (${exec.requirementsCovered}/${exec.requirementsTotal} requirements covered)`,
    `- **Self-healing**: ${pct(exec.healRate)} of failures were auto-healed`,
    `- **Requirement coverage score**: ${exec.coverageScore}/100`,
    '',
  ];

  if (exec.topRisks.length > 0) {
    lines.push('### Top Risks');
    exec.topRisks.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }

  if (exec.recommendedActions.length > 0) {
    lines.push('### Recommended Actions');
    exec.recommendedActions.forEach((a) => lines.push(`- ${a}`));
    lines.push('');
  }

  lines.push(`_Report generated at ${exec.generatedAt}_`);
  return lines.join('\n');
}

// ── internals ─────────────────────────────────────────────────────────────────

function countCoveredRequirements(
  traceability: AgentRunReport['traceability'],
): number {
  const covered = new Set<string>();
  for (const r of traceability) {
    if (r.status === 'passed') covered.add(r.requirementId);
  }
  return covered.size;
}

function deriveTopRisks(failures: FailureReport[]): string[] {
  if (failures.length === 0) return [];

  // Group by classification
  const byClass = new Map<string, number>();
  for (const f of failures) {
    byClass.set(f.classification, (byClass.get(f.classification) ?? 0) + 1);
  }

  return [...byClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cls, count]) => `${count} ${cls.toLowerCase().replace(/_/g, ' ')} failure(s)`);
}

const ACTION_PRIORITY: Record<RecommendedAction, number> = {
  CREATE_DEFECT:      1,
  CHECK_ENVIRONMENT:  2,
  FIX_TEST:           3,
  SELF_HEAL:          4,
  INVESTIGATE:        5,
  RETRY:              6,
  MONITOR:            7,
};

const ACTION_LABELS: Record<RecommendedAction, string> = {
  CREATE_DEFECT:      'File product defect tickets for unresolved failures',
  CHECK_ENVIRONMENT:  'Investigate environment / infrastructure stability',
  FIX_TEST:           'Review and fix test automation defects',
  SELF_HEAL:          'Run self-healing pipeline on remaining locator failures',
  INVESTIGATE:        'Manually investigate unclassified failures',
  RETRY:              'Re-run transient failures in a stable environment',
  MONITOR:            'Monitor flaky tests over the next few runs',
};

function deriveRecommendedActions(
  failures: FailureReport[],
  healedCount: number,
  summary: AgentRunReport['summary'],
): string[] {
  const actions = new Set<RecommendedAction>();
  for (const f of failures) actions.add(f.recommendedAction);

  // If healing succeeded, remove SELF_HEAL from actions (already done)
  if (healedCount > 0 && failures.every((f) => f.recommendedAction !== 'SELF_HEAL')) {
    actions.delete('SELF_HEAL');
  }

  // Add MONITOR when flaky count is significant
  if (summary.flaky > 0) actions.add('MONITOR');

  return [...actions]
    .sort((a, b) => (ACTION_PRIORITY[a] ?? 99) - (ACTION_PRIORITY[b] ?? 99))
    .map((a) => ACTION_LABELS[a] ?? a);
}
