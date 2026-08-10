import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CreateDevicePoolCommand,
  CreateUploadCommand,
  DeviceFarmClient,
  GetRunCommand,
  GetUploadCommand,
  ListArtifactsCommand,
  ListDevicePoolsCommand,
  ListDevicesCommand,
  ListJobsCommand,
  ListProjectsCommand,
  ListRunsCommand,
  ScheduleRunCommand,
  type UploadType,
} from '@aws-sdk/client-device-farm';
import {
  linkLatest,
  prune,
  type RetentionPolicy,
  type RunMeta,
} from '../core/runstore.js';
import { appendDeviceVideos } from '../report/html.js';

/**
 * AWS Device Farm runs the NATIVE half of the suite.
 *
 * Device Farm accepts Appium (Node/Python/Java), XCUITest and Espresso — it does
 * not run Playwright, and its desktop-browser product is Selenium-only. So the
 * web half of the suite runs elsewhere (locally, or a Playwright grid) and only
 * the Appium package is uploaded here. Keeping that split explicit is cheaper
 * than discovering it during a release.
 */

export interface FarmConfig {
  region: string;
  /** arn:aws:devicefarm:us-west-2:...:project:... */
  projectArn: string;
  /** Device pool to run against. A small, real-device pool beats a large emulator pool. */
  devicePoolArn: string;
  platform: 'android' | 'ios';
  /** .apk or .ipa */
  appPath: string;
  /** zip produced by `npm run farm:bundle` — the Appium Node test package. */
  testPackagePath: string;
  /** testspec.yml telling Device Farm how to run the package. */
  testSpecPath: string;
  runName?: string;
  /** Give up waiting after this long. Device Farm queues can be slow. */
  timeoutMs?: number;
  jobTimeoutMinutes?: number;
  videoCapture?: boolean;
  /** Exported into the testspec's `test` phase before the runner starts. */
  env?: Record<string, string>;
  /**
   * Where to unpack the run directory the device produced. Without this the
   * verdicts, flake classification and heal suggestions are computed on the
   * device and discarded when the container is torn down.
   */
  runsDir?: string;
  /** Where the rolling flake window lives locally, so the device's copy can merge in. */
  flakeDb?: string;
  /** Only for the `latest-<platform>` pointer; the run itself lives in runsDir. */
  reportsDir?: string;
  retention?: RetentionPolicy;
}

/** Device Farm is slow enough that silence reads as a hang. */
export type FarmLog = (line: string) => void;

/** Indexes into FARM_STAGES (core/history.ts); the two lists must stay aligned. */
export interface FarmEvents {
  log: FarmLog;
  stage?: (index: number) => void;
}

export interface FarmDevice {
  arn: string;
  name: string;
  platform: string;
  os: string;
  formFactor: string;
  manufacturer: string;
  /** PHONE/TABLET availability: HIGHLY_AVAILABLE | AVAILABLE | BUSY | TEMPORARY_NOT_AVAILABLE */
  availability: string;
  /** Device Farm marks emulators/simulators separately; real devices catch more. */
  remoteAccessEnabled: boolean;
}

export interface FarmRunResult {
  runArn: string;
  status: string;
  result: string;
  counters: Record<string, number | undefined>;
  artifacts: Array<{ name: string; type: string; url: string }>;
}

export interface AwsStatus {
  ok: boolean;
  /** Why not, in words a person can act on. */
  reason?: string;
  /** First four characters only — enough to tell two keys apart, useless if leaked. */
  keyHint?: string;
  /** Where the credentials came from, as far as it can be told. */
  source: string;
  /** Set only for temporary credentials. */
  expiresAt?: string;
  expiresInMinutes?: number;
  /**
   * Whether offering a login button here makes sense: only when credentials are
   * a local session, never when they come from the environment or a role, where
   * the fix is a deployment change and a browser would open on a server.
   */
  canLogin: boolean;
}

/**
 * Whether this process can talk to Device Farm right now, and for how long.
 *
 * Worth its own call because the alternative is what kept happening: a run was
 * scheduled, 216MB was uploaded, the device started, and then the polling loop
 * died with "Could not load credentials from any providers" — after the money
 * was spent. Credentials are a precondition, so they get checked like one.
 *
 * The identity is not fetched (that needs STS, another dependency); instead a
 * cheap Device Farm call proves the credentials are not merely present but
 * accepted, which is the question actually being asked.
 */
export async function awsStatus(region: string): Promise<AwsStatus> {
  const source = credentialSource();
  const canLogin = source === '~/.aws hoặc IAM role của máy' && (await awsLoginBinary()) !== undefined;
  const client = new DeviceFarmClient({ region });
  try {
    const creds = await client.config.credentials();
    const out: AwsStatus = { ok: true, source, canLogin, keyHint: creds.accessKeyId.slice(0, 4) };
    if (creds.expiration) {
      out.expiresAt = creds.expiration.toISOString();
      out.expiresInMinutes = Math.round((creds.expiration.getTime() - Date.now()) / 60_000);
    }
    // Present is not the same as accepted: an expired session resolves fine and
    // fails on first use.
    await client.send(new ListProjectsCommand({}));
    return out;
  } catch (err) {
    return { ok: false, source, canLogin, reason: firstLine((err as Error).message) };
  }
}

/**
 * Best-effort label for where credentials came from. Environment and container
 * roles are detectable; beyond that the provider chain does not say, so this
 * reports honestly rather than guessing precisely.
 */
function credentialSource(): string {
  const e = process.env;
  if (e.AWS_ACCESS_KEY_ID) return 'biến môi trường';
  if (e.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || e.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    return 'IAM role của container';
  }
  if (e.AWS_WEB_IDENTITY_TOKEN_FILE) return 'web identity (IRSA)';
  if (e.AWS_PROFILE) return `profile "${e.AWS_PROFILE}"`;
  return '~/.aws hoặc IAM role của máy';
}

function firstLine(message: string): string {
  return message.split('\n')[0]!.trim();
}

/**
 * Runs `aws login` and streams what it says.
 *
 * Only meaningful when the browser, the person and the server are the same
 * machine — the command opens a browser locally and waits for a human. On a
 * deployed box there is no browser to open, and the credential it would produce
 * is a person's, expiring in about an hour. So the UI offers this only for the
 * local case; see AwsStatus.canLogin.
 *
 * The binary is searched for rather than assumed: `aws login` shipped in a
 * recent CLI, and a machine can easily have an older `aws` first on PATH — this
 * one does, which is why an already-valid session looked like no session at all
 * for a while.
 */
export async function awsLogin(region: string, log: FarmLog): Promise<void> {
  const bin = await awsLoginBinary();
  if (!bin) {
    throw new Error(
      'Không tìm thấy bản AWS CLI nào hỗ trợ `aws login`. ' +
        'Cần AWS CLI v2 đủ mới; bản cũ hơn không có lệnh này.',
    );
  }
  log(`Dùng ${bin} — trình duyệt sẽ mở ra để bạn xác nhận.`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['login', '--region', region], { stdio: ['ignore', 'pipe', 'pipe'] });
    const emit = (buf: Buffer) => {
      for (const line of buf.toString().split('\n')) if (line.trim()) log(line.trimEnd());
    };
    child.stdout.on('data', emit);
    child.stderr.on('data', emit);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`aws login thoát với mã ${code}`)),
    );
  });
}

/** First `aws` on PATH or in the usual places that actually knows `login`. */
async function awsLoginBinary(): Promise<string | undefined> {
  const candidates = [
    process.env.TESTPILOT_AWS_CLI,
    `${process.env.HOME ?? ''}/.local/bin/aws`,
    '/opt/homebrew/bin/aws',
    '/usr/local/bin/aws',
    'aws',
  ].filter((c): c is string => Boolean(c));

  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(bin, ['login', 'help'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
    if (ok) return bin;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Discovery — what the UI's pickers are filled from                    */
/* ------------------------------------------------------------------ */

export async function listProjects(region: string) {
  const client = new DeviceFarmClient({ region });
  const out: Array<{ arn: string; name: string }> = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(new ListProjectsCommand(nextToken ? { nextToken } : {}));
    for (const p of page.projects ?? []) if (p.arn && p.name) out.push({ arn: p.arn, name: p.name });
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

export async function listDevicePools(region: string, projectArn: string) {
  const client = new DeviceFarmClient({ region });
  const out: Array<{ arn: string; name: string; type: string; description: string }> = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListDevicePoolsCommand({ arn: projectArn, ...(nextToken ? { nextToken } : {}) }),
    );
    for (const p of page.devicePools ?? []) {
      if (p.arn && p.name) {
        out.push({ arn: p.arn, name: p.name, type: p.type ?? '', description: p.description ?? '' });
      }
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

/**
 * Every device Device Farm offers for one platform. This is a long list (many
 * hundreds), so the caller filters it; returning it whole keeps the filtering
 * in the browser where it is instant.
 */
export async function listDevices(region: string, platform: 'android' | 'ios'): Promise<FarmDevice[]> {
  const client = new DeviceFarmClient({ region });
  const want = platform === 'android' ? 'ANDROID' : 'IOS';
  const out: FarmDevice[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListDevicesCommand({
        filters: [{ attribute: 'PLATFORM', operator: 'EQUALS', values: [want] }],
        ...(nextToken ? { nextToken } : {}),
      }),
    );
    for (const d of page.devices ?? []) {
      if (!d.arn || !d.name) continue;
      out.push({
        arn: d.arn,
        name: d.name,
        platform: d.platform ?? want,
        os: d.os ?? '',
        formFactor: d.formFactor ?? '',
        manufacturer: d.manufacturer ?? '',
        availability: d.availability ?? 'UNKNOWN',
        remoteAccessEnabled: Boolean(d.remoteAccessEnabled),
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

/**
 * Runs in a project, newest first — enough to identify one, not to report on it.
 *
 * Exists so `farm:pull` can default to "the run I just started" without the
 * caller having to copy an ARN out of a terminal that may already be gone.
 */
export async function listRuns(region: string, projectArn: string) {
  const client = new DeviceFarmClient({ region });
  const page = await client.send(new ListRunsCommand({ arn: projectArn }));
  return (page.runs ?? [])
    .filter((r): r is typeof r & { arn: string } => Boolean(r.arn))
    .map((r) => ({
      arn: r.arn,
      name: r.name ?? '',
      status: r.status ?? '',
      result: r.result ?? '',
      started: r.started?.toISOString() ?? '',
    }));
}

/**
 * Turns a hand-picked set of devices into a pool, because ScheduleRun only
 * accepts a pool ARN. An ARN-IN rule pins the exact devices, which is what you
 * want for a regression suite — a rule-based pool silently changes membership
 * as AWS retires hardware.
 */
export async function createDevicePool(
  region: string,
  projectArn: string,
  name: string,
  deviceArns: string[],
): Promise<{ arn: string; name: string }> {
  if (deviceArns.length === 0) throw new Error('Chọn ít nhất một device trước khi tạo pool.');
  const client = new DeviceFarmClient({ region });
  const created = await client.send(
    new CreateDevicePoolCommand({
      projectArn,
      name,
      description: 'Created by TestPilot',
      rules: [{ attribute: 'ARN', operator: 'IN', value: JSON.stringify(deviceArns) }],
      maxDevices: deviceArns.length,
    }),
  );
  const arn = created.devicePool?.arn;
  if (!arn) throw new Error('Device Farm did not return a device pool ARN.');
  return { arn, name: created.devicePool?.name ?? name };
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/**
 * Checked before any stage starts, so an incomplete form fails as configuration
 * rather than as a failed "packaging" step it never reached.
 */
export function assertFarmReady(cfg: FarmConfig): void {
  for (const [field, value] of [
    ['projectArn', cfg.projectArn],
    ['devicePoolArn', cfg.devicePoolArn],
    ['appPath', cfg.appPath],
  ] as const) {
    if (!value) throw new Error(`Thiếu farm.${field} — chưa chạy được trên Device Farm.`);
  }
}

/** A device run plus queueing; below this, credentials will expire mid-flight. */
const RUN_HEADROOM_MINUTES = 15;

export async function scheduleFarmRun(
  cfg: FarmConfig,
  ev: FarmEvents = { log: () => {} },
): Promise<FarmRunResult> {
  const log = ev.log;
  const stage = ev.stage ?? (() => {});
  assertFarmReady(cfg);

  // Before the 216MB upload, not after. A run that dies on credentials halfway
  // through has already been paid for.
  const aws = await awsStatus(cfg.region);
  if (!aws.ok) {
    throw new Error(
      `Không dùng được credential AWS (nguồn: ${aws.source}).\n${aws.reason ?? ''}\n\n` +
        'Đặt AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, hoặc gắn IAM role cho máy chạy.',
    );
  }
  if (aws.expiresInMinutes !== undefined && aws.expiresInMinutes < RUN_HEADROOM_MINUTES) {
    log(
      `Credential chỉ còn ${aws.expiresInMinutes} phút — một lượt chạy thường lâu hơn thế. ` +
        'Làm mới trước, nếu không kết quả sẽ mắc lại trên AWS (lấy về bằng npm run farm:pull).',
    );
  }

  const client = new DeviceFarmClient({ region: cfg.region });
  const specPath = await renderTestSpec(cfg.testSpecPath, cfg.env ?? {});

  stage(1);
  log(`Upload ${cfg.platform === 'android' ? 'APK' : 'IPA'}: ${path.basename(cfg.appPath)}`);
  const appArn = await upload(
    client,
    cfg.projectArn,
    cfg.appPath,
    cfg.platform === 'android' ? 'ANDROID_APP' : 'IOS_APP',
  );
  log(`Upload test package: ${path.basename(cfg.testPackagePath)}`);
  const testArn = await upload(
    client,
    cfg.projectArn,
    cfg.testPackagePath,
    'APPIUM_NODE_TEST_PACKAGE',
  );
  log('Upload testspec…');
  const specArn = await upload(client, cfg.projectArn, specPath, 'APPIUM_NODE_TEST_SPEC');

  const scheduled = await client.send(
    new ScheduleRunCommand({
      projectArn: cfg.projectArn,
      appArn,
      devicePoolArn: cfg.devicePoolArn,
      name: cfg.runName || `testpilot-${new Date().toISOString()}`,
      test: { type: 'APPIUM_NODE', testPackageArn: testArn, testSpecArn: specArn },
      configuration: { billingMethod: 'METERED' },
      executionConfiguration: {
        ...(cfg.jobTimeoutMinutes ? { jobTimeoutMinutes: cfg.jobTimeoutMinutes } : {}),
        videoCapture: cfg.videoCapture ?? true,
      },
    }),
  );

  const runArn = scheduled.run?.arn;
  if (!runArn) throw new Error('Device Farm did not return a run ARN.');
  log(`Run đã lên lịch: ${runArn}`);

  return collectFarmRun(cfg, runArn, ev);
}

/**
 * Waits for a run that is already on Device Farm and brings its results home.
 *
 * Split out of `scheduleFarmRun` because the two halves fail independently: the
 * run lives on AWS, but the polling loop lives on a laptop whose credentials
 * expire, whose network drops, and whose terminal gets closed. When that
 * happened the run kept going and finished perfectly — and its report, videos
 * and verdicts were stranded behind a presigned URL nobody would ever fetch.
 * Being able to re-attach by ARN turns a lost run into a resumed one.
 */
export async function collectFarmRun(
  cfg: FarmConfig,
  runArn: string,
  ev: FarmEvents = { log: () => {} },
): Promise<FarmRunResult> {
  const log = ev.log;
  const stage = ev.stage ?? (() => {});
  const client = new DeviceFarmClient({ region: cfg.region });

  stage(2);
  const run = await waitForRun(client, runArn, cfg.timeoutMs ?? 60 * 60_000, log);

  stage(3);
  // Per job, because a device pool produces one job per device and each has its
  // own report, its own screenshots and its own verdict.
  const jobs = await listJobs(client, runArn);
  const artifacts = await listArtifacts(client, runArn);
  log(`${jobs.length} thiết bị, ${artifacts.length} artifact.`);

  if (cfg.runsDir) {
    for (const job of jobs) {
      const jobArtifacts = await listArtifacts(client, job.arn);
      const runDir = await pullReport(jobArtifacts, cfg.runsDir, job, cfg.flakeDb, log);
      if (!runDir) {
        log(`${job.deviceName}: không tìm thấy report — kiểm tra phase post_test của testspec.`);
        continue;
      }
      // The device's screen recording is a Device Farm artifact, not something
      // the runner produced, so it is not in the bundle and the report
      // generated on the device cannot reference it. Fetch it into the same run
      // directory, before the presigned URL expires and the only recording of a
      // passing run is gone.
      await pullFarmVideos(jobArtifacts, runDir, log);
      await stampFarmMeta(runDir, runArn, job);
      await linkLatest(cfg.reportsDir ?? 'reports', cfg.platform, runDir);
    }
    // Once, after every device is in: pruning between jobs could delete a run
    // that the next job is about to be compared against.
    await prune(cfg.runsDir, cfg.retention);
  }

  return {
    runArn,
    status: run.status ?? 'UNKNOWN',
    result: run.result ?? 'UNKNOWN',
    counters: {
      total: run.counters?.total,
      passed: run.counters?.passed,
      failed: run.counters?.failed,
      errored: run.counters?.errored,
      skipped: run.counters?.skipped,
      warned: run.counters?.warned,
    },
    artifacts,
  };
}

async function upload(
  client: DeviceFarmClient,
  projectArn: string,
  filePath: string,
  type: UploadType,
): Promise<string> {
  const abs = path.resolve(filePath);
  await stat(abs); // Fail here rather than after a slow presigned PUT.

  const created = await client.send(
    new CreateUploadCommand({ projectArn, name: path.basename(abs), type }),
  );
  const { arn, url } = created.upload ?? {};
  if (!arn || !url) throw new Error(`Device Farm refused the upload slot for ${abs}.`);

  const body = await readFile(abs);
  const res = await fetch(url, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`Upload PUT failed for ${abs}: ${res.status} ${res.statusText}`);

  // Device Farm processes the upload asynchronously; scheduling against an
  // upload that is still INITIALIZED fails with a confusing ARN error.
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const got = await client.send(new GetUploadCommand({ arn }));
    const status = got.upload?.status;
    if (status === 'SUCCEEDED') return arn;
    if (status === 'FAILED') {
      throw new Error(`Device Farm rejected ${path.basename(abs)}: ${got.upload?.message}`);
    }
    if (Date.now() > deadline) throw new Error(`Upload of ${abs} stuck in ${status}.`);
    await sleep(5_000);
  }
}

/**
 * The checked-in testspec has no environment block, because what the app under
 * test needs differs per team and per environment. Rather than make people edit
 * YAML, the configured variables are injected as `export` lines at the top of
 * the `test` phase — the last place they can be set before the runner starts.
 *
 * Returns the original path untouched when there is nothing to inject, so the
 * common case still uploads the file you can read in the repo.
 */
export async function renderTestSpec(
  testSpecPath: string,
  env: Record<string, string>,
): Promise<string> {
  const entries = Object.entries(env).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
  if (entries.length === 0) return testSpecPath;

  const yaml = await readFile(path.resolve(testSpecPath), 'utf8');
  assertCommandsAreStrings(testSpecPath, yaml);
  const marker = /^(\s+)test:\n(\s+)commands:\n/m.exec(yaml);
  if (!marker) {
    throw new Error(`${testSpecPath} không có phase "test:" để chèn biến môi trường.`);
  }

  const indent = `${marker[2]}  `;
  const exports = entries
    .map(([k, v]) => `${indent}- export ${k}=${shellQuote(v)}\n`)
    .join('');
  const patched = yaml.slice(0, marker.index + marker[0].length) +
    exports +
    yaml.slice(marker.index + marker[0].length);

  const out = path.join(os.tmpdir(), 'testpilot-farm', `testspec-${Date.now()}.yml`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, patched, 'utf8');
  return out;
}

/**
 * Rejects a command that YAML will read as a mapping instead of a string.
 *
 * An unquoted scalar containing a colon followed by a space is a key/value
 * pair. `- echo "device: $X"` therefore reaches Device Farm as
 * `{echo "device": "$X"}`, the shell says `command not found`, and — the part
 * that actually hurts — the rest of the test phase never runs. The runner is
 * never started, no report is written, and the run looks like the app failed.
 *
 * Caught here because the alternative is finding out from a device log after
 * paying for the run.
 */
function assertCommandsAreStrings(file: string, yaml: string): void {
  const bad: string[] = [];
  for (const line of yaml.split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (!item) continue;
    const body = item[1]!;
    // A quoted scalar is safe whatever it contains, and so is a comment.
    if (/^['"]/.test(body) || body.startsWith('#') || body.startsWith('>')) continue;
    // Only a colon *followed by whitespace* splits; `${X:-y}` and `http://` do not.
    if (/:(\s|$)/.test(body.replace(/#.*$/, ''))) bad.push(body.trim());
  }
  if (bad.length === 0) return;
  throw new Error(
    `${file}: ${bad.length} lệnh sẽ bị YAML hiểu thành mapping thay vì chuỗi:\n` +
      bad.map((b) => `  - ${b}`).join('\n') +
      '\n\nMột scalar không đóng ngoặc chứa ": " là cặp key/value. ' +
      'Bỏ dấu hai chấm, hoặc bọc cả lệnh trong dấu nháy đơn.',
  );
}

/** Single-quote for POSIX sh, so a value with spaces or $ cannot run anything. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function waitForRun(
  client: DeviceFarmClient,
  arn: string,
  timeoutMs: number,
  log: FarmLog = () => {},
) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const { run } = await client.send(new GetRunCommand({ arn }));
    const status = run?.status ?? 'UNKNOWN';
    if (status !== last) {
      const c = run?.counters;
      const counts = c ? ` (${c.passed ?? 0} passed / ${c.failed ?? 0} failed / ${c.total ?? 0})` : '';
      log(`${status}${counts}`);
      last = status;
    }
    if (status === 'COMPLETED') return run!;
    if (Date.now() > deadline) {
      throw new Error(`Run ${arn} did not complete within ${Math.round(timeoutMs / 60000)}m.`);
    }
    await sleep(30_000);
  }
}

export interface FarmJob {
  arn: string;
  /** The real device, e.g. "Google Pixel 7". Not the placeholder the runner invents. */
  deviceName: string;
  os: string;
  status: string;
  result: string;
}

/**
 * One job per device in the pool.
 *
 * Artifacts have to be collected per job, not per run: a three-device pool
 * produces three of everything, and asking the run for "the" customer artifact
 * quietly returns the first and discards the rest — two devices paid for and
 * never seen. The job is also the only place the real device name exists; the
 * runner on board knows nothing but the placeholder from the config file.
 */
export async function listJobs(client: DeviceFarmClient, runArn: string): Promise<FarmJob[]> {
  const out: FarmJob[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListJobsCommand({ arn: runArn, ...(nextToken ? { nextToken } : {}) }),
    );
    for (const j of page.jobs ?? []) {
      if (!j.arn) continue;
      out.push({
        arn: j.arn,
        deviceName: j.device?.name ?? j.name ?? 'unknown device',
        os: j.device?.os ?? '',
        status: j.status ?? '',
        result: j.result ?? '',
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

/** `Google Pixel 7` -> `google-pixel-7`, for a directory name. */
export function deviceSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'device'
  );
}

async function listArtifacts(client: DeviceFarmClient, arn: string) {
  const out: FarmRunResult['artifacts'] = [];
  for (const type of ['LOG', 'FILE', 'SCREENSHOT'] as const) {
    let nextToken: string | undefined;
    do {
      const page = await client.send(
        new ListArtifactsCommand({ arn, type, ...(nextToken ? { nextToken } : {}) }),
      );
      for (const a of page.artifacts ?? []) {
        if (a.name && a.type && a.url) out.push({ name: a.name, type: a.type, url: a.url });
      }
      nextToken = page.nextToken;
    } while (nextToken);
  }
  return out;
}

/**
 * Device Farm returns the container's log directory as one zip per job. The
 * run directory we want is inside it, under `runs/`. Unpacked locally so the
 * UI's E2E History tab shows a farm run the same way it shows a local one.
 *
 * Returns the local run directory, so the caller can put the device's own
 * screen recording alongside the report that describes it.
 *
 * Uses the system `unzip` rather than adding a zip dependency for one call;
 * failing to unpack is reported, never fatal — the run's verdict already came
 * back through the API and must not be lost to a missing binary.
 */
async function pullReport(
  artifacts: FarmRunResult['artifacts'],
  runsDir: string,
  job: FarmJob,
  flakeDb: string | undefined,
  log: FarmLog,
): Promise<string | undefined> {
  const bundle = artifacts.find((a) => a.type === 'CUSTOMER_ARTIFACT');
  if (!bundle) return undefined;

  const tmp = path.join(os.tmpdir(), `testpilot-farm-${Date.now()}`);
  const zip = path.join(tmp, 'artifacts.zip');
  try {
    await mkdir(tmp, { recursive: true });
    const res = await fetch(bundle.url);
    if (!res.ok) throw new Error(`tải artifact hỏng: ${res.status}`);
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));

    await run('unzip', ['-qo', zip, '-d', tmp]);
    const found = await findDir(tmp, 'runs');
    if (!found) return undefined;

    // The directory exists whenever post_test ran, even on a run that died
    // before generating anything. Copying an empty tree and calling it a
    // success would leave the E2E History tab showing the *previous* run's
    // report as if it were this one's.
    const html = await findFile(found, 'index.html');
    if (!html) {
      log('Thư mục runs rỗng — lượt chạy chết trước khi sinh được report.');
      return undefined;
    }

    await mkdir(runsDir, { recursive: true });
    // The device names its directory after the timestamp and platform, which is
    // the same on every device in the pool — copying them all in as-is would
    // have each job overwrite the last. The real device name is what tells them
    // apart, so it goes in the directory name.
    const onDevice = path.dirname(html);
    const localRunDir = path.join(runsDir, `${path.basename(onDevice)}-${deviceSlug(job.deviceName)}`);
    await rm(localRunDir, { recursive: true, force: true });
    await mkdir(localRunDir, { recursive: true });
    await run('cp', ['-R', `${onDevice}/.`, localRunDir]);

    // The report was rendered on the device, so its screenshot links point at
    // the container's log directory ($DEVICEFARM_LOG_DIR) and resolve to
    // nothing here. Bring the images across and repoint the links, otherwise
    // every piece of failure evidence in a farm report is a broken image.
    const moved = await recoverArtifacts(tmp, path.join(localRunDir, 'artifacts'), localRunDir);
    const merged = flakeDb
      ? await mergeFlakeDb(tmp, flakeDb, job, await runnerDeviceLabel(localRunDir), log)
      : 0;
    log(
      `${job.deviceName} → ${localRunDir}` +
        `${moved ? ` (+${moved} ảnh)` : ''}${merged ? ` (+${merged} mục flaky)` : ''}`,
    );
    return localRunDir;
  } catch (err) {
    log(`Không giải nén được report: ${(err as Error).message}`);
    return undefined;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Breadth-first search for a directory by name, a few levels deep. */
async function findDir(root: string, name: string, depth = 5): Promise<string | undefined> {
  if (depth === 0) return undefined;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === name) return full;
    const nested = await findDir(full, name, depth - 1);
    if (nested) return nested;
  }
  return undefined;
}

/** What the runner called this device, read back from the report it wrote. */
async function runnerDeviceLabel(runDir: string): Promise<string | undefined> {
  const file = path.join(runDir, 'report.json');
  if (!existsSync(file)) return undefined;
  try {
    const { report } = JSON.parse(await readFile(file, 'utf8')) as {
      report: { results?: Array<{ device?: string }> };
    };
    return report.results?.find((r) => r.device)?.device;
  } catch {
    return undefined;
  }
}

/**
 * Merges the flake window the device produced back into the local database.
 *
 * The window travels up inside the test package and used to die with the
 * container, so six device runs left no history and flaky-versus-broken could
 * never be decided for native at all.
 *
 * Merged by key, not by file. Every device in a pool starts from the same
 * bundled copy and writes only its own `scenario::platform::device` entries;
 * taking the file wholesale would let the last job overwrite the others with a
 * copy of the shared starting point. Only entries belonging to this job's
 * device are taken, which is exactly the set it had the right to change.
 */
async function mergeFlakeDb(
  bundleRoot: string,
  flakeDb: string,
  job: FarmJob,
  runnerLabel: string | undefined,
  log: FarmLog,
): Promise<number> {
  const [incoming] = await findFiles(bundleRoot, /(^|\/)flake\.json$/i);
  if (!incoming || !runnerLabel) return 0;

  const authoritative = job.deviceName + (job.os ? ` (Android ${job.os})` : '');
  type Db = { version?: number; scenarios?: Record<string, unknown> };
  try {
    const fromDevice = JSON.parse(await readFile(incoming, 'utf8')) as Db;
    // Rewrite rather than match. The runner labels a device with whatever it
    // has — on Device Farm that is DEVICEFARM_DEVICE_NAME, which turns out to
    // be a serial like 44161JEKB12760 — while the job record has the human
    // name. Demanding the two agree merged nothing at all; the job name is the
    // authority, so the device's own keys are renamed onto it. Two handsets of
    // the same model then share one bucket, which is the behaviour worth
    // tracking: "Pixel 8a", not "that particular unit".
    const suffix = `::${runnerLabel}`;
    const mine = Object.entries(fromDevice.scenarios ?? {})
      .filter(([key]) => key.endsWith(suffix))
      .map(([key, value]) => [key.slice(0, -suffix.length) + `::${authoritative}`, value] as const);
    if (mine.length === 0) return 0;

    const local: Db = existsSync(flakeDb)
      ? (JSON.parse(await readFile(flakeDb, 'utf8')) as Db)
      : { version: 1, scenarios: {} };
    local.scenarios = { ...(local.scenarios ?? {}), ...Object.fromEntries(mine) };
    await mkdir(path.dirname(flakeDb), { recursive: true });
    await writeFile(flakeDb, JSON.stringify(local, null, 2) + '\n', 'utf8');
    return mine.length;
  } catch (err) {
    // A run whose flake history cannot be merged still has its report; losing
    // the window is not worth failing the pull over.
    log(`Không gộp được lịch sử flaky: ${firstLine((err as Error).message)}`);
    return 0;
  }
}

/**
 * Copies the run's screenshots out of the artifact bundle and rewrites the
 * report to point at them.
 *
 * Matching is by basename: the device's absolute paths are meaningless locally,
 * but the filenames the runner generated are unique per scenario and attempt.
 * Returns how many images were recovered.
 */
export async function recoverArtifacts(
  bundleRoot: string,
  artifactsDir: string,
  reportDir: string,
): Promise<number> {
  const images = await findFiles(bundleRoot, /\.(png|jpg|webm|mp4)$/i);
  if (images.length === 0) return 0;

  await mkdir(artifactsDir, { recursive: true });
  for (const src of images) {
    await run('cp', [src, path.join(artifactsDir, path.basename(src))]);
  }

  const indexFile = path.join(reportDir, 'index.html');
  let html = await readFile(indexFile, 'utf8');
  const rel = path.relative(reportDir, path.resolve(artifactsDir)).split(path.sep).join('/');
  for (const src of images) {
    const base = path.basename(src);
    // Replace whatever container path preceded the filename, wherever it appears.
    html = html.replaceAll(new RegExp(`(src|href)="[^"]*${escapeRe(base)}"`, 'g'), `$1="${rel}/${base}"`);
  }
  await writeFile(indexFile, html, 'utf8');

  // report.json has to be repointed as well, not just the rendered page.
  // It stores the device's own absolute paths, and it is the input the report
  // is rebuilt from — repair only the HTML and every future re-render puts the
  // dead `/tmp/devicefarm-workspace/...` paths straight back.
  const jsonFile = path.join(reportDir, 'report.json');
  if (existsSync(jsonFile)) {
    let json = await readFile(jsonFile, 'utf8');
    // Paths in report.json are relative to the working directory, which is what
    // the reporter resolves them against.
    const local = path.join(reportDir, path.basename(artifactsDir));
    for (const src of images) {
      const base = path.basename(src);
      json = json.replaceAll(
        new RegExp(`"[^"]*${escapeRe(base)}"`, 'g'),
        JSON.stringify(path.join(local, base)),
      );
    }
    await writeFile(jsonFile, json, 'utf8');
  }
  return images.length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every file under `root` matching `pattern`, a few levels deep. */
async function findFiles(root: string, pattern: RegExp, depth = 6): Promise<string[]> {
  if (depth === 0) return [];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) out.push(full);
    else if (entry.isDirectory()) out.push(...(await findFiles(full, pattern, depth - 1)));
  }
  return out;
}

/** Same walk as findDir, but for a file — used to tell a real report from an empty dir. */
async function findFile(root: string, name: string, depth = 4): Promise<string | undefined> {
  if (depth === 0) return undefined;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const nested = await findFile(full, name, depth - 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let err = '';
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} thoát mã ${code}: ${err.trim()}`)),
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Downloads Device Farm's own screen recording into the run directory.
 *
 * Playwright records the web half itself, so its videos are already local and
 * already referenced. On a device the recording belongs to Device Farm: it
 * arrives as a separate `VIDEO` artifact behind a presigned URL that expires in
 * a few hours, and the report — rendered on the device before the recording
 * existed — has no way to know about it. Without this, a passing device run
 * leaves no evidence at all.
 */
async function pullFarmVideos(
  artifacts: FarmRunResult['artifacts'],
  runDir: string,
  log: FarmLog,
): Promise<void> {
  const videos = artifacts.filter((a) => a.type === 'VIDEO');
  if (videos.length === 0) return;

  const dir = path.join(runDir, 'artifacts', 'video');
  await mkdir(dir, { recursive: true });

  const saved: string[] = [];
  for (const [i, v] of videos.entries()) {
    const file = path.join(dir, `devicefarm-${i + 1}.mp4`);
    try {
      const res = await fetch(v.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      saved.push(file);
    } catch (err) {
      log(`Không tải được video ${v.name}: ${(err as Error).message}`);
    }
  }
  if (saved.length === 0) return;
  log(`${saved.length} video từ thiết bị → ${dir}`);
  // The markup lives in the reporter, so a re-rendered report and a freshly
  // pulled one are the same document.
  await appendDeviceVideos(runDir);
}

/**
 * Records the Device Farm verdict and run ARN into the run's own meta.json.
 *
 * The runner on the device wrote its verdict from the scenarios it executed;
 * Device Farm has a verdict of its own that also covers the setup, install and
 * teardown phases the runner never sees. When they disagree, the farm is right,
 * and keeping the ARN means the run can always be traced back to AWS.
 */
async function stampFarmMeta(runDir: string, runArn: string, job: FarmJob): Promise<void> {
  const file = path.join(runDir, 'meta.json');
  if (!existsSync(file)) return;
  try {
    const meta = JSON.parse(await readFile(file, 'utf8')) as RunMeta;
    meta.farmRunArn = runArn;
    meta.kind = 'farm';
    // The directory was renamed on copy to carry the device; the id has to
    // follow. It is the key everything else looks the run up by, and left
    // stale it points at a path that no longer exists — the run vanishes from
    // the history page while sitting right there on disk.
    meta.id = path.basename(runDir);
    // The runner only knows the placeholder from the config file. The real
    // device name is what the flake history is keyed on, so it has to be right:
    // one bucket per device, or a scenario that fails on one phone and passes
    // on another reads as 50% flaky instead of broken on that phone.
    meta.device = job.deviceName + (job.os ? ` (Android ${job.os})` : '');
    if (job.result !== 'PASSED' && meta.status === 'passed') meta.status = 'failed';
    await writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {
    // A run whose meta is unreadable still has its report; losing the ARN
    // stamp is not worth failing the pull over.
  }
}
