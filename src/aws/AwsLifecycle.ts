/**
 * AWS Device Farm run lifecycle — item 41 (plan §63, §64).
 *
 * Models the full run state machine and persists it to disk so the agent can
 * resume after a crash without submitting a duplicate run.
 *
 * State machine (plan §63):
 *   BUILDING → UPLOADING → SUBMITTED → QUEUED → RUNNING → COMPLETED
 *
 * Failure states:
 *   BUILD_FAILED | UPLOAD_FAILED | QUEUE_TIMEOUT |
 *   DEVICE_UNAVAILABLE | RUN_FAILED | ARTIFACT_COLLECTION_FAILED
 *
 * Idempotency (plan §64):
 *   Persisted record includes a submission fingerprint derived from
 *   (agentRunId + scenarioId + appHash). Before submitting a new run the
 *   caller checks for an existing record with the same fingerprint.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// ── state machine ─────────────────────────────────────────────────────────────

export type DeviceFarmRunStatus =
  | 'BUILDING'
  | 'UPLOADING'
  | 'SUBMITTED'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'BUILD_FAILED'
  | 'UPLOAD_FAILED'
  | 'QUEUE_TIMEOUT'
  | 'DEVICE_UNAVAILABLE'
  | 'RUN_FAILED'
  | 'ARTIFACT_COLLECTION_FAILED';

export const TERMINAL_STATUSES = new Set<DeviceFarmRunStatus>([
  'COMPLETED',
  'BUILD_FAILED',
  'UPLOAD_FAILED',
  'QUEUE_TIMEOUT',
  'DEVICE_UNAVAILABLE',
  'RUN_FAILED',
  'ARTIFACT_COLLECTION_FAILED',
]);

export const FAILURE_STATUSES = new Set<DeviceFarmRunStatus>([
  'BUILD_FAILED',
  'UPLOAD_FAILED',
  'QUEUE_TIMEOUT',
  'DEVICE_UNAVAILABLE',
  'RUN_FAILED',
  'ARTIFACT_COLLECTION_FAILED',
]);

const VALID_TRANSITIONS: Partial<Record<DeviceFarmRunStatus, DeviceFarmRunStatus[]>> = {
  BUILDING: ['UPLOADING', 'BUILD_FAILED'],
  UPLOADING: ['SUBMITTED', 'UPLOAD_FAILED'],
  SUBMITTED: ['QUEUED', 'DEVICE_UNAVAILABLE'],
  QUEUED: ['RUNNING', 'QUEUE_TIMEOUT', 'DEVICE_UNAVAILABLE'],
  RUNNING: ['COMPLETED', 'RUN_FAILED'],
  COMPLETED: [],
};

// ── persisted record (plan §64) ───────────────────────────────────────────────

export interface DeviceFarmRun {
  /** Local agent run id — from AgentStateMachine. */
  agentRunId: string;
  /** AWS Device Farm run ARN. Set after SUBMITTED. */
  awsRunArn?: string;
  /** The test scenario this run covers. */
  scenarioId: string;
  /** Hash of (agentRunId + scenarioId + appPath) — prevents duplicate submissions. */
  submissionFingerprint: string;
  status: DeviceFarmRunStatus;
  platform: 'android' | 'ios';
  devicePoolArn?: string;
  /** Upload ARNs created during UPLOADING phase. */
  uploadArns?: string[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  /** AWS Device Farm result string (PASSED/FAILED/ERRORED/STOPPED/SKIPPED). */
  awsResult?: string;
  /** Error detail for failure statuses. */
  errorMessage?: string;
  /** Sequential state transition log for auditability. */
  transitions: Array<{ from: DeviceFarmRunStatus; to: DeviceFarmRunStatus; at: string }>;
}

// ── persistence ───────────────────────────────────────────────────────────────

const FILENAME = 'aws-run.json';

export class AwsLifecycle {
  private record: DeviceFarmRun;
  private readonly filePath: string;

  private constructor(record: DeviceFarmRun, dir: string) {
    this.record = record;
    this.filePath = path.join(dir, FILENAME);
  }

  /** Create a new lifecycle record. Throws if a record with this fingerprint already exists. */
  static async create(
    dir: string,
    opts: {
      agentRunId: string;
      scenarioId: string;
      platform: 'android' | 'ios';
      appPath: string;
    },
  ): Promise<AwsLifecycle> {
    const fp = buildFingerprint(opts.agentRunId, opts.scenarioId, opts.appPath);
    const now = new Date().toISOString();

    const record: DeviceFarmRun = {
      agentRunId: opts.agentRunId,
      scenarioId: opts.scenarioId,
      submissionFingerprint: fp,
      status: 'BUILDING',
      platform: opts.platform,
      startedAt: now,
      updatedAt: now,
      transitions: [],
    };

    await mkdir(dir, { recursive: true });
    const lc = new AwsLifecycle(record, dir);
    await lc.persist();
    return lc;
  }

  /** Load an existing lifecycle record. Returns null when none exists. */
  static async load(dir: string): Promise<AwsLifecycle | null> {
    const filePath = path.join(dir, FILENAME);
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, 'utf8');
    const record = JSON.parse(raw) as DeviceFarmRun;
    return new AwsLifecycle(record, dir);
  }

  get current(): Readonly<DeviceFarmRun> {
    return this.record;
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this.record.status);
  }

  isFailure(): boolean {
    return FAILURE_STATUSES.has(this.record.status);
  }

  /** Transition to a new status, persist the change, and record the transition. */
  async transition(
    next: DeviceFarmRunStatus,
    opts: { awsRunArn?: string; awsResult?: string; errorMessage?: string } = {},
  ): Promise<void> {
    const allowed = VALID_TRANSITIONS[this.record.status];
    if (allowed !== undefined && !allowed.includes(next)) {
      throw new Error(
        `Invalid lifecycle transition: ${this.record.status} → ${next}. ` +
        `Allowed: ${allowed.length > 0 ? allowed.join(', ') : '(none — terminal)'}`,
      );
    }

    const now = new Date().toISOString();
    this.record = {
      ...this.record,
      status: next,
      updatedAt: now,
      ...(TERMINAL_STATUSES.has(next) ? { endedAt: now } : {}),
      ...(opts.awsRunArn != null ? { awsRunArn: opts.awsRunArn } : {}),
      ...(opts.awsResult != null ? { awsResult: opts.awsResult } : {}),
      ...(opts.errorMessage != null ? { errorMessage: opts.errorMessage } : {}),
      transitions: [
        ...this.record.transitions,
        { from: this.record.status, to: next, at: now },
      ],
    };

    await this.persist();
  }

  /** Record upload ARNs produced during the UPLOADING phase. */
  async setUploadArns(arns: string[]): Promise<void> {
    this.record = { ...this.record, uploadArns: arns, updatedAt: new Date().toISOString() };
    await this.persist();
  }

  /** Record device pool used for submission. */
  async setDevicePool(arn: string): Promise<void> {
    this.record = { ...this.record, devicePoolArn: arn, updatedAt: new Date().toISOString() };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.record, null, 2) + '\n', 'utf8');
  }
}

// ── fingerprint ───────────────────────────────────────────────────────────────

/**
 * Build a submission fingerprint from stable inputs.
 * Same fingerprint → same logical run → do not submit again.
 */
export function buildFingerprint(
  agentRunId: string,
  scenarioId: string,
  appPath: string,
): string {
  const raw = `${agentRunId}::${scenarioId}::${appPath}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Check whether a fingerprint matches an existing persisted record.
 * Returns the existing record when found so the caller can resume.
 */
export async function findExistingRun(
  dir: string,
  fingerprint: string,
): Promise<DeviceFarmRun | null> {
  const lc = await AwsLifecycle.load(dir);
  if (!lc) return null;
  if (lc.current.submissionFingerprint !== fingerprint) return null;
  return lc.current;
}
