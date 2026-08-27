import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The record behind "My Recent Scenarios". A workflow is stored as a list of
 * named stages rather than a single status, because the useful question after a
 * failure is not "did it fail" but "how far did it get" — 3/7 tells you the
 * Gherkin pass never ran, 6/7 tells you generation was fine and binding broke.
 */

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface WorkflowStage {
  name: string;
  status: StageStatus;
}

export type QuestionKind = 'text' | 'radio' | 'checkbox';

/**
 * Something the system cannot decide on its own and must not guess.
 *
 * Two very different situations produce these. Generation raises them when the
 * source document is genuinely ambiguous — which watchlist, whether deleting
 * from one category affects another — questions a human can answer from
 * business knowledge and no amount of observation would settle.
 *
 * Healing raises them when it has formed a hypothesis it is not entitled to
 * try: the action it wants to test is risky, or it cannot tell which of several
 * candidate actions is meant. Guessing there is how an automated experiment
 * places a real order on a real account, so the guess becomes a question
 * instead.
 */
export interface WorkflowQuestion {
  id: string;
  kind: QuestionKind;
  /** The question itself, in the operator's language. */
  prompt: string;
  /**
   * Why the run is blocked on this. Shown alongside the question because an
   * operator who cannot see why it is being asked cannot judge the answer —
   * and a question nobody understands gets answered arbitrarily.
   */
  rationale?: string;
  /** Choices for radio/checkbox. Ignored for text. */
  options?: string[];
  /**
   * Always a list, including for `text` and `radio`, so consumers never branch
   * on the kind just to read the value.
   */
  answer?: string[];
  answeredAt?: string;
  /** Which mechanism raised it, so a healing answer can be traced to its run. */
  source: 'generation' | 'healing';
  /** For healing questions: where the run got stuck. */
  context?: { scenario?: string; line?: number; screen?: string };
}

export interface WorkflowRun {
  id: string;
  /** Target feature name, i.e. what the .feature file is called. */
  feature: string;
  kind: 'gen' | 'run' | 'farm' | 'workflow';
  /** Execution platform for Device Farm runs. Older history may omit it. */
  platform?: 'android' | 'ios';
  startedAt: string;
  finishedAt?: string;
  /**
   * `waiting_review` and `waiting_input` are durable pauses, not completed or
   * failed runs. They differ in what is being waited for: review is a human
   * checking work already done, input is the run unable to proceed until a
   * question is answered.
   */
  status: 'running' | 'waiting_review' | 'waiting_input' | 'passed' | 'failed';
  stages: WorkflowStage[];
  /**
   * Questions raised by this run. Kept even after answering: the answers are
   * the record of why the run did what it did, and a question that had to be
   * asked once is a candidate for becoming a durable registry note.
   */
  questions?: WorkflowQuestion[];
  /** Trimmed to the tail — this file is a history index, not a log store. */
  log: string[];
  error?: string;
  /** Basenames of run directories created for this farm run (one per device). */
  runDirs?: string[];
  /** Feature produced by this workflow; review and execution stay scoped to it. */
  generatedFile?: string;
  generated?: {
    scenarios: number;
    steps: number;
    screens: number;
    elements: number;
    visuals?: number;
    coverageRequirements?: number;
    coverageCovered?: number;
    coverageMissing?: Array<{
      id: string;
      priority: 'P0' | 'P1';
      rule: string;
    }>;
    coverageRepaired?: boolean;
  };
  /** Execution choices captured before generation so resume is deterministic. */
  execution?: {
    platforms: Array<'web' | 'android' | 'ios'>;
    /** Chosen separately from the local platforms; see config workflow.deviceFarm. */
    deviceFarm?: { platform: 'android' | 'ios' };
    env?: string;
    headed?: boolean;
    locatorRetries?: number;
  };
  /**
   * The farm run this workflow handed off to, if any.
   *
   * A link rather than an embedded stage list: a farm run owns four stages of
   * its own, its own artifacts and its own device minutes, and flattening that
   * into one line of the workflow would hide exactly what is worth seeing while
   * it is slow — uploading, queued for a device, or collecting artifacts.
   */
  farmRunId?: string;
}

/** Keeps the JSON small enough to read on every page load. */
const MAX_RUNS = 50;
const MAX_LOG_LINES = 400;

/**
 * How many workflow runs survive regardless of what else happened.
 *
 * The cap above used to apply to every kind out of one bucket, so a cheap kind
 * evicted an expensive one: 31 farm runs had pushed the history down to 12
 * workflows, and a workflow is minutes of document reading, two model calls, a
 * generated suite and a human review. Re-running a suite twenty times must not
 * cost the record of the run that produced it.
 */
const MIN_WORKFLOW_RUNS = 25;

export const GEN_STAGES = [
  'Đọc tài liệu nguồn',
  'Phân tích màn hình & element',
  'Lưu element registry',
  'Sinh Gherkin',
  'Chuẩn hoá và bind step',
  'Ghi bản nháp và mở hàng chờ duyệt',
  'Hoàn tất',
] as const;

/** One end-to-end Studio workflow with a single durable human review gate. */
export const WORKFLOW_STAGES = [
  'Đọc và xác thực tài liệu',
  'AI phân tích yêu cầu, màn hình và element',
  'Cập nhật element registry',
  'Sinh bộ testcase',
  'Chuẩn hoá và bind step',
  'Chờ duyệt / chỉnh sửa testcase',
  'Chuẩn bị môi trường automation',
  'Chạy các kịch bản đã duyệt',
  'Healing và chạy lại lỗi locator',
  'Sinh report, ảnh và video',
  'Hoàn tất workflow',
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

  find(id: string): WorkflowRun | undefined {
    return this.runs.find((run) => run.id === id);
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

  /**
   * Runs this instance has never seen, read back from disk at write time.
   *
   * More than one History can be open on the same file: a workflow keeps one
   * for its own record and the farm handoff opens another for the farm run.
   * Each holds only the runs it loaded, so writing an instance's array
   * wholesale deletes whatever the other one added — the farm record vanished
   * the moment the workflow saved again.
   */
  private async mergeWithDisk(): Promise<WorkflowRun[]> {
    let onDisk: WorkflowRun[] = [];
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { runs?: WorkflowRun[] };
      onDisk = parsed.runs ?? [];
    } catch {
      // No file yet, or an unreadable one. This instance is then the whole
      // truth, which is the same position `load` takes.
    }
    // This instance wins for ids it holds: it is the one actively mutating them,
    // and the copy on disk is by definition older.
    const mine = new Set(this.runs.map((run) => run.id));
    return [...this.runs, ...onDisk.filter((run) => !mine.has(run.id))]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async write(): Promise<void> {
    // Retention is applied to the union, not to this instance's slice, or a
    // merge would keep resurrecting runs that retention just dropped.
    this.runs = retain(await this.mergeWithDisk());
    for (const r of this.runs) r.log = r.log.slice(-MAX_LOG_LINES);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ version: 1, runs: this.runs }, null, 2) + '\n', 'utf8');
  }
}

/**
 * Newest first, capped — but never dropping a workflow while a cheaper record
 * could go instead.
 */
export function retain(runs: WorkflowRun[]): WorkflowRun[] {
  const workflows = runs.filter((run) => run.kind === 'workflow');
  const keptWorkflows = new Set(workflows.slice(0, MIN_WORKFLOW_RUNS));
  const rest = runs.filter((run) => !keptWorkflows.has(run));
  const kept = new Set([
    ...keptWorkflows,
    ...rest.slice(0, Math.max(0, MAX_RUNS - keptWorkflows.size)),
  ]);
  // Original order, so the file stays newest-first and diffs stay readable.
  return runs.filter((run) => kept.has(run));
}

export function stagesDone(run: WorkflowRun): number {
  return run.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
}
