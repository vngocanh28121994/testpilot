/**
 * Traceability chain builder — item 45 (plan §25).
 *
 * Assembles the full chain:
 *   Requirement → TestCase → Gherkin Scenario → AWS Run → Evidence
 *
 * Every record is self-contained so a consumer can render it without
 * cross-referencing the original TestCaseModel or ExecutionResult objects.
 */

import type { TestCaseModel } from '../model/TestCaseModel.js';
import type { ExecutionResult, RunStatus } from '../execution/ExecutionTypes.js';
import type { TraceabilityRecord } from './ReportTypes.js';

// ── builder ───────────────────────────────────────────────────────────────────

/**
 * Build a flat list of traceability records from test cases and their results.
 *
 * Each record links one requirement → one test case → one execution result.
 * A test case with multiple requirementIds produces one record per requirement
 * so the requirement-level view is complete.
 *
 * @param testCases     All TestCaseModels planned for this run.
 * @param resultsByTcId Map of testCaseId → ExecutionResult (built by executor).
 *                      Each TestCaseModel maps to at most one ExecutionResult.
 * @param awsRunArn     AWS Device Farm run ARN (set after submission).
 * @param gherkinPaths  Map of testCaseId → .feature file path (optional).
 */
export function buildTraceability(
  testCases: TestCaseModel[],
  resultsByTcId: ReadonlyMap<string, ExecutionResult>,
  awsRunArn?: string,
  gherkinPaths?: ReadonlyMap<string, string>,
): TraceabilityRecord[] {
  const records: TraceabilityRecord[] = [];

  for (const tc of testCases) {
    const result = resultsByTcId.get(tc.id);
    const status: RunStatus = result?.status ?? 'skipped';
    const gherkinPath = gherkinPaths?.get(tc.id);

    const requirementIds = tc.requirementIds.length > 0
      ? tc.requirementIds
      : ['(no-requirement)'];

    for (const reqId of requirementIds) {
      records.push({
        requirementId: reqId,
        testCaseId: tc.id,
        // Treat testCaseId as scenarioId (1:1 mapping in TestPilot).
        // Callers with multi-scenario test cases should pass the scenario id
        // explicitly via a per-tc override map.
        scenarioId: tc.id,
        gherkinPath,
        awsRunArn,
        status,
        evidence: result?.artifacts ?? [],
      });
    }
  }

  // Stable sort: requirement → testCase
  records.sort((a, b) => {
    const req = a.requirementId.localeCompare(b.requirementId);
    if (req !== 0) return req;
    return a.testCaseId.localeCompare(b.testCaseId);
  });

  return records;
}

/**
 * Build a resultsByTcId map from a list of ExecutionResults.
 *
 * ExecutionResult.runId is the per-scenario run id (set by the executor to
 * the testCaseId it was running). Callers that produce results with a
 * different id scheme should build the map themselves.
 */
export function indexResultsByTestCaseId(
  results: ExecutionResult[],
): Map<string, ExecutionResult> {
  const m = new Map<string, ExecutionResult>();
  for (const r of results) {
    // runId is used as the test-case key; executors must set it to tc.id.
    m.set(r.runId, r);
  }
  return m;
}

/**
 * Produce a human-readable traceability matrix (Markdown table).
 * Suitable for embedding in a report artifact or logging.
 */
export function formatTraceabilityMatrix(records: TraceabilityRecord[]): string {
  if (records.length === 0) return '_No traceability records._\n';

  const header = '| Requirement | Test Case | Scenario | Status | AWS Run |';
  const sep    = '|-------------|-----------|----------|--------|---------|';
  const rows = records.map((r) => {
    const arn = r.awsRunArn ? (r.awsRunArn.split('/').pop() ?? r.awsRunArn) : '—';
    return `| ${r.requirementId} | ${r.testCaseId} | ${r.scenarioId} | ${r.status.toUpperCase()} | ${arn} |`;
  });

  return [header, sep, ...rows].join('\n') + '\n';
}

/**
 * Summarise requirement coverage from traceability records.
 * Returns { covered, total, pct } where covered counts requirements
 * that have at least one passing execution.
 */
export function summarizeRequirementCoverage(records: TraceabilityRecord[]): {
  covered: number;
  total: number;
  pct: number;
} {
  const all = new Set(records.map((r) => r.requirementId));
  const passed = new Set(
    records.filter((r) => r.status === 'passed').map((r) => r.requirementId),
  );

  const total   = all.size;
  const covered = passed.size;
  return {
    covered,
    total,
    pct: total > 0 ? Math.round((covered / total) * 100) : 0,
  };
}
