import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunReport } from '../core/types.js';

export interface ReportShotContext {
  scenario: string;
  detail: string;
  error?: string;
  knownIssue?: string;
}

export interface KnownIssueLookup {
  active(id: string, contentHash: string): { note: string } | undefined;
}

/**
 * Joins an artifact filename back to the step that produced it.
 *
 * `tap-declined-<timestamp>` intentionally has no scenario slug, so parsing
 * the filename can never answer which case failed. `report.json` already owns
 * the exact screenshot path, step and error; use that authoritative join.
 */
export async function reportShotContexts(
  runDir: string,
  knownIssues?: KnownIssueLookup,
): Promise<Map<string, ReportShotContext>> {
  try {
    const stored = JSON.parse(
      await readFile(path.join(runDir, 'report.json'), 'utf8'),
    ) as { report?: Pick<RunReport, 'results'> };
    const contexts = new Map<string, ReportShotContext>();

    for (const result of stored.report?.results ?? []) {
      const issue = result.scenario.contentHash
        ? knownIssues?.active(result.scenario.id, result.scenario.contentHash)
        : undefined;
      for (const run of result.runs) {
        if (run.proof) {
          contexts.set(path.basename(run.proof), {
            scenario: result.scenario.name,
            detail: `bằng chứng sau khi pass${run.attempt > 1 ? ` · lần thử ${run.attempt}` : ''}`,
            ...(issue ? { knownIssue: issue.note } : {}),
          });
        }
        for (const step of run.steps) {
          if (!step.screenshot) continue;
          const action = `${step.step.keyword} ${step.step.text}`.trim();
          contexts.set(path.basename(step.screenshot), {
            scenario: result.scenario.name,
            detail: step.status === 'failed'
              ? `${issue ? 'known issue' : 'lúc fail'} · dòng ${step.step.line} · ${action}`
              : action,
            ...(step.error?.message ? { error: firstErrorLine(step.error.message) } : {}),
            ...(issue ? { knownIssue: issue.note } : {}),
          });
        }
      }
    }
    return contexts;
  } catch {
    // Old/interrupted runs may have artifacts but no structured report. Their
    // filename fallback remains available; one malformed run must not hide all
    // other reports from /api/state.
    return new Map();
  }
}

function firstErrorLine(message: string): string {
  return message.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) ?? message.slice(0, 240);
}
