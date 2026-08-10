import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The record behind "My Recent Scenarios". A workflow is stored as a list of
 * named stages rather than a single status, because the useful question after a
 * failure is not "did it fail" but "how far did it get" — 3/7 tells you the
 * Gherkin pass never ran, 6/7 tells you generation was fine and binding broke.
 */

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface WorkflowStage {
  name: string;
  status: StageStatus;
}

export interface WorkflowRun {
  id: string;
  /** Target feature name, i.e. what the .feature file is called. */
  feature: string;
  kind: 'gen' | 'run' | 'farm';
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'passed' | 'failed';
  stages: WorkflowStage[];
  /** Trimmed to the tail — this file is a history index, not a log store. */
  log: string[];
  error?: string;
}

/** Keeps the JSON small enough to read on every page load. */
const MAX_RUNS = 50;
const MAX_LOG_LINES = 400;

export const GEN_STAGES = [
  'Đọc tài liệu nguồn',
  'Phân tích màn hình & element',
  'Lưu element registry',
  'Sinh Gherkin',
  'Ghi file .feature',
  'Bind step vào element',
  'Hoàn tất',
] as const;

/** Indexed by the `stage` callback in farm/devicefarm.ts — keep them aligned. */
export const FARM_STAGES = [
  'Đóng gói test package',
  'Upload app + package lên Device Farm',
  'Chờ Device Farm chạy',
  'Thu artifact',
] as const;

export class History {
  private constructor(
    private readonly file: string,
    private runs: WorkflowRun[],
  ) {}

  static async load(file = 'registry/history.json'): Promise<History> {
    const abs = path.resolve(file);
    if (!existsSync(abs)) return new History(abs, []);
    try {
      const parsed = JSON.parse(await readFile(abs, 'utf8')) as { runs?: WorkflowRun[] };
      return new History(abs, parsed.runs ?? []);
    } catch {
      // History is a convenience, never a correctness input — start over quietly.
      return new History(abs, []);
    }
  }

  list(): WorkflowRun[] {
    return [...this.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Creates a run in the `running` state and persists it immediately, so a
   *  crashed or killed process still leaves a visible trace in the table. */
  start(feature: string, kind: WorkflowRun['kind'], stageNames: readonly string[]): WorkflowRun {
    const run: WorkflowRun = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      feature,
      kind,
      startedAt: new Date().toISOString(),
      status: 'running',
      stages: stageNames.map((name) => ({ name, status: 'pending' })),
      log: [],
    };
    this.runs.push(run);
    return run;
  }

  /**
   * Saves are chained rather than run concurrently. Stage transitions fire
   * fast enough during generation that two overlapping whole-file writes to
   * the same path could interleave and leave invalid JSON on disk.
   */
  save(): Promise<void> {
    this.writing = this.writing.then(() => this.write()).catch(() => {});
    return this.writing;
  }

  private writing: Promise<void> = Promise.resolve();

  private async write(): Promise<void> {
    this.runs = this.list().slice(0, MAX_RUNS);
    for (const r of this.runs) r.log = r.log.slice(-MAX_LOG_LINES);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ version: 1, runs: this.runs }, null, 2) + '\n', 'utf8');
  }
}

export function stagesDone(run: WorkflowRun): number {
  return run.stages.filter((s) => s.status === 'done').length;
}
