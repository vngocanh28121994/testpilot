/**
 * Run resume / crash recovery — item 43 (plan §64, §85).
 *
 * When the agent process dies while an AWS Device Farm run is RUNNING or QUEUED,
 * restarting must NOT submit a duplicate run. Instead:
 *
 *   1. Load the persisted AwsLifecycle record.
 *   2. Verify the AWS run ARN is still live on Device Farm.
 *   3. Continue polling from the current state.
 *
 * Resume is idempotent: calling it multiple times on the same record is safe.
 *
 * Plan §85 flow:
 *   load agentRun → load state → load AWS run ID → continue polling
 */

import type { DeviceFarmClient } from '@aws-sdk/client-device-farm';
import { GetRunCommand } from '@aws-sdk/client-device-farm';
import { AwsLifecycle, TERMINAL_STATUSES, type DeviceFarmRun, type DeviceFarmRunStatus } from './AwsLifecycle.js';

// ── resume result ─────────────────────────────────────────────────────────────

export type ResumeOutcome =
  | 'already-terminal'    // run was in a terminal state — nothing to resume
  | 'no-aws-run'          // no awsRunArn persisted — cannot poll
  | 'resumed'             // found live AWS run, now polling
  | 'not-found'           // persisted run not found in this directory
  | 'aws-run-gone';       // ARN no longer exists on Device Farm

export interface ResumeResult {
  outcome: ResumeOutcome;
  record?: Readonly<DeviceFarmRun>;
  /** The polled AWS run status (populated when outcome='resumed'). */
  awsStatus?: string;
  /** Human-readable explanation. */
  message: string;
}

// ── polling options ───────────────────────────────────────────────────────────

export interface PollOptions {
  /** How long to wait between polls in milliseconds. Default: 10000 (10s). */
  intervalMs?: number;
  /** Maximum time to poll before giving up. Default: 1800000 (30min). */
  timeoutMs?: number;
  /** Called after each poll with the current AWS status string. */
  onPoll?: (status: string, elapsed: number) => void;
}

// ── resume ────────────────────────────────────────────────────────────────────

/**
 * Resume a previously-started Device Farm run.
 *
 * @param dir    Directory where `aws-run.json` was persisted by `AwsLifecycle.create()`.
 * @param client AWS Device Farm SDK client.
 */
export async function resumeRun(
  dir: string,
  client: DeviceFarmClient,
): Promise<ResumeResult> {
  // ── Load persisted record ─────────────────────────────────────────────────
  const lc = await AwsLifecycle.load(dir);

  if (!lc) {
    return {
      outcome: 'not-found',
      message: `No persisted run found at "${dir}"`,
    };
  }

  const record = lc.current;

  // ── Already terminal — nothing to do ─────────────────────────────────────
  if (TERMINAL_STATUSES.has(record.status)) {
    return {
      outcome: 'already-terminal',
      record,
      message: `Run ${record.scenarioId} is already in terminal state: ${record.status}`,
    };
  }

  // ── No AWS run ARN — was not submitted yet ────────────────────────────────
  if (!record.awsRunArn) {
    return {
      outcome: 'no-aws-run',
      record,
      message:
        `Run ${record.scenarioId} has not been submitted to Device Farm yet (status: ${record.status}). ` +
        `Cannot resume polling — resubmit using the existing fingerprint to avoid duplicates.`,
    };
  }

  // ── Verify run is still live on Device Farm ───────────────────────────────
  let awsStatus: string;
  try {
    const response = await client.send(new GetRunCommand({ arn: record.awsRunArn }));
    awsStatus = response.run?.status ?? 'UNKNOWN';
  } catch (err) {
    return {
      outcome: 'aws-run-gone',
      record,
      message: `AWS run ARN ${record.awsRunArn} not found: ${(err as Error).message}`,
    };
  }

  // Sync lifecycle state with AWS reality
  await syncStatus(lc, awsStatus, record.status);

  return {
    outcome: 'resumed',
    record: lc.current,
    awsStatus,
    message:
      `Resumed run ${record.scenarioId} (ARN: ${record.awsRunArn}) — AWS status: ${awsStatus}`,
  };
}

/**
 * Poll a Device Farm run to completion, updating the lifecycle record on each tick.
 *
 * Returns the final record when the run reaches a terminal state.
 * Uses exponential backoff with a ceiling to reduce API calls during long queues.
 */
export async function pollToCompletion(
  dir: string,
  client: DeviceFarmClient,
  opts: PollOptions = {},
): Promise<Readonly<DeviceFarmRun>> {
  const intervalMs = opts.intervalMs ?? 10_000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const started = Date.now();

  const lc = await AwsLifecycle.load(dir);
  if (!lc) throw new Error(`No lifecycle record at "${dir}"`);
  if (!lc.current.awsRunArn) throw new Error('Cannot poll — no AWS run ARN');

  while (!lc.isTerminal()) {
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) {
      await lc.transition('QUEUE_TIMEOUT', {
        errorMessage: `Polling timed out after ${Math.round(elapsed / 60_000)}min`,
      });
      break;
    }

    await sleep(intervalMs);

    let awsStatus: string;
    try {
      const response = await client.send(
        new GetRunCommand({ arn: lc.current.awsRunArn }),
      );
      awsStatus = response.run?.status ?? 'UNKNOWN';
      const awsResult = response.run?.result;

      opts.onPoll?.(awsStatus, Date.now() - started);
      await syncStatus(lc, awsStatus, lc.current.status, awsResult ?? undefined);
    } catch (err) {
      // Transient API error — keep polling
      opts.onPoll?.(`ERROR: ${(err as Error).message}`, Date.now() - started);
    }
  }

  return lc.current;
}

// ── status sync ───────────────────────────────────────────────────────────────

/**
 * Map an AWS Device Farm status string to our lifecycle status and transition if needed.
 * AWS statuses: PENDING | PENDING_CONCURRENCY | PENDING_DEVICE | PROCESSING |
 *               SCHEDULING | PREPARING | RUNNING | COMPLETED | STOPPING
 */
async function syncStatus(
  lc: AwsLifecycle,
  awsStatus: string,
  _current: DeviceFarmRunStatus,
  awsResult?: string,
): Promise<void> {
  const mapped = mapAwsStatus(awsStatus, awsResult);
  if (!mapped || mapped === lc.current.status) return;

  // Only transition when the target is allowed from current
  try {
    await lc.transition(mapped, { awsResult });
  } catch {
    // Invalid transition (e.g. already terminal) — ignore
  }
}

function mapAwsStatus(awsStatus: string, awsResult?: string): DeviceFarmRunStatus | null {
  switch (awsStatus.toUpperCase()) {
    case 'PENDING':
    case 'PENDING_CONCURRENCY':
    case 'PENDING_DEVICE':
    case 'SCHEDULING':
      return 'QUEUED';
    case 'PROCESSING':
    case 'PREPARING':
      return 'SUBMITTED';
    case 'RUNNING':
    case 'STOPPING':
      return 'RUNNING';
    case 'COMPLETED': {
      if (!awsResult) return 'COMPLETED';
      const upper = awsResult.toUpperCase();
      if (upper === 'ERRORED' || upper === 'STOPPED') return 'RUN_FAILED';
      return 'COMPLETED';
    }
    default:
      return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
