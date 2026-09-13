import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpenQuestion, Platform, RunReport, ScenarioResult } from './types.js';

export const RUN_STATE_FILE = 'run-state.json';

export interface PlannedScenario {
  id: string;
  name: string;
}

/**
 * The durable part of a local run.
 *
 * The runner rewrites this after every scenario boundary and immediately
 * before starting the next scenario. A machine loss can therefore cost at
 * most the in-flight scenario; completed ScenarioResult objects survive and
 * can be rendered without interpreting human-facing log text.
 */
export interface RunCheckpoint {
  version: 1;
  reportRunId: string;
  startedAt: string;
  updatedAt: string;
  platform: Platform;
  device?: string;
  planned: PlannedScenario[];
  results: ScenarioResult[];
  quarantined: RunReport['quarantined'];
  openQuestions: OpenQuestion[];
  currentScenario?: PlannedScenario;
}

export async function writeRunCheckpoint(
  runDir: string,
  checkpoint: Omit<RunCheckpoint, 'version' | 'updatedAt'>,
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const target = path.join(runDir, RUN_STATE_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  const value: RunCheckpoint = {
    ...checkpoint,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  // rename is atomic on the local filesystem. A hard crash leaves either the
  // previous complete checkpoint or the new one, never half a JSON document.
  await rename(temp, target);
}

export async function readRunCheckpoint(runDir: string): Promise<RunCheckpoint | undefined> {
  const file = path.join(runDir, RUN_STATE_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as RunCheckpoint;
    if (
      value.version !== 1
      || !Array.isArray(value.planned)
      || !Array.isArray(value.results)
      || !Array.isArray(value.quarantined)
      || !Array.isArray(value.openQuestions)
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export async function removeRunCheckpoint(runDir: string): Promise<void> {
  await unlink(path.join(runDir, RUN_STATE_FILE)).catch(() => {});
}

export function interruptedReportFromCheckpoint(
  checkpoint: RunCheckpoint,
  finishedAt: string,
  reason: string,
): RunReport {
  const completed = new Set(checkpoint.results.map((result) => result.scenario.id));
  const skipped = new Set(checkpoint.quarantined.map((scenario) => scenario.id));
  const activeId = checkpoint.currentScenario?.id;
  const notRun = checkpoint.planned.filter((scenario) =>
    !completed.has(scenario.id) && !skipped.has(scenario.id) && scenario.id !== activeId);

  return {
    runId: checkpoint.reportRunId,
    startedAt: checkpoint.startedAt,
    finishedAt,
    status: 'interrupted',
    results: checkpoint.results,
    healSuggestions: [],
    ...(checkpoint.openQuestions.length > 0 ? { openQuestions: checkpoint.openQuestions } : {}),
    quarantined: checkpoint.quarantined,
    interruption: {
      reason,
      platform: checkpoint.platform,
      ...(checkpoint.device ? { device: checkpoint.device } : {}),
      ...(checkpoint.currentScenario ? { activeScenario: checkpoint.currentScenario } : {}),
      notRun,
      source: 'checkpoint',
    },
  };
}
