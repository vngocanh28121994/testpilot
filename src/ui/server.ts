import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigSchema, loadConfig, saveConfig, type TestPilotConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import { listRuns } from '../core/runstore.js';
import { FARM_STAGES, GEN_STAGES, History, stagesDone, type WorkflowRun } from '../core/history.js';
import { Secrets, farmSecretEnv, secretEnvName } from '../core/secrets.js';
import {
  assertFarmReady,
  awsLogin,
  awsStatus,
  createDevicePool,
  listDevicePools,
  listDevices,
  listProjects,
  scheduleFarmRun,
} from '../farm/devicefarm.js';
import { runGenPipeline } from '../genspec/pipeline.js';
import { McpBridge, guessToolNames } from '../ingest/mcp.js';
import { parseFeature } from '../steps/binding.js';

/**
 * Local control panel. Single user, single machine — so it is a plain node:http
 * server with no framework and no bundler. It edits the same
 * `testpilot.config.json` the CLI reads, which keeps the UI a convenience
 * rather than a second source of truth.
 */

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.TESTPILOT_UI_PORT ?? 4300);
const CONFIG_FILE = process.env.TESTPILOT_CONFIG ?? 'testpilot.config.json';

/** Shown when the Models API is unreachable (no key, offline, restricted org). */
const FALLBACK_MODELS = [
  { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  // Without the right type the browser downloads the recording instead of
  // playing it inline, which defeats the point of embedding it.
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

createServer((req, res) => {
  handle(req, res).catch((err: Error) => {
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`TestPilot UI  →  http://localhost:${PORT}`);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/state':
      return json(res, 200, await state());

    case 'PUT /api/config': {
      const body = await readJson<TestPilotConfig>(req);
      const parsed = ConfigSchema.safeParse(body);
      if (!parsed.success) {
        return json(res, 400, {
          error: 'Config không hợp lệ',
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      await saveConfig(parsed.data, CONFIG_FILE);
      return json(res, 200, { ok: true, config: parsed.data });
    }

    case 'POST /api/mcp/tools':
      return json(res, 200, await mcpTools(await readJson(req)));

    case 'GET /api/models':
      return json(res, 200, await models());

    case 'GET /api/history':
      return json(res, 200, { runs: await recentRuns() });

    // Saving and running are separate on purpose. Generation needs an API key,
    // so without this the only way to persist a test account was to run the
    // whole pipeline — and anyone without a key typed their credentials into a
    // form that silently discarded them.
    case 'POST /api/studio/save': {
      const saved = await applyForm(await readJson<StudioForm>(req));
      const secrets = await Secrets.load();
      return json(res, 200, {
        ok: true,
        accounts: saved.accounts.map((a) => ({ ...a, hasPassword: secrets.has(a.label) })),
      });
    }

    case 'POST /api/gen': {
      const form = await readJson<StudioForm>(req);
      // Persist before streaming: the form is the config, and a run whose inputs
      // were never saved could not be reproduced from a terminal.
      const cfg = await applyForm(form);
      return stream(res, (log, stage) => runWorkflow(cfg, log, stage));
    }

    case 'POST /api/run': {
      const body = await readJson<{ platform: string; tag?: string; headed?: boolean }>(req);
      return stream(res, (log) => runSuite(body.platform, body.tag, Boolean(body.headed), log));
    }

    /* ---- AWS Device Farm ---- */

    case 'POST /api/aws/login':
      // Streamed: `aws login` prints a URL and then waits for a human, so the
      // useful part is the output as it arrives, not the exit code.
      return stream(res, (log) => awsLogin(region(url), log));

    case 'GET /api/aws':
      return json(res, 200, await awsStatus(region(url)));

    case 'GET /api/farm/projects':
      return json(res, 200, await guarded(() => listProjects(region(url))));

    case 'GET /api/farm/pools':
      return json(
        res,
        200,
        await guarded(() => listDevicePools(region(url), url.searchParams.get('projectArn') ?? '')),
      );

    case 'GET /api/farm/devices': {
      const platform = url.searchParams.get('platform') === 'ios' ? 'ios' : 'android';
      return json(res, 200, await guarded(() => listDevices(region(url), platform)));
    }

    case 'POST /api/farm/pool': {
      const body = await readJson<{
        region: string;
        projectArn: string;
        name: string;
        deviceArns: string[];
      }>(req);
      return json(
        res,
        200,
        await guarded(() =>
          createDevicePool(body.region, body.projectArn, body.name, body.deviceArns),
        ),
      );
    }

    case 'POST /api/farm/app':
      return json(res, 200, await saveAppBinary(req, url.searchParams.get('name') ?? ''));

    case 'POST /api/farm/run': {
      const body = await readJson<FarmForm>(req);
      const cfg = await applyFarmForm(body);
      // Reject an incomplete form as a 400 before a run exists, rather than
      // recording a history entry whose first stage "failed" for no real reason.
      try {
        assertFarmReady(cfg.farm);
      } catch (err) {
        return json(res, 400, { error: (err as Error).message });
      }
      return stream(res, (log, stage) => runOnFarm(cfg, Boolean(body.bundle), log, stage));
    }
  }

  // A run directory holds its own screenshots and videos, so serving `runs`
  // is enough for a current report. `reports` and `artifacts` stay reachable
  // for runs recorded under the old per-platform layout.
  for (const dir of ['runs', 'reports', 'artifacts'] as const) {
    if (req.method === 'GET' && url.pathname.startsWith(`/${dir}/`)) {
      const root = path.resolve(dir);
      const file = path.resolve(root, url.pathname.replace(new RegExp(`^/${dir}/+`), ''));
      if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'forbidden' });
      return serveFile(res, file, req.headers.range);
    }
  }
  if (req.method === 'GET') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, name);
    // Never let a crafted path escape the public directory.
    if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
    return serveFile(res, file);
  }
  json(res, 404, { error: `No route for ${route}` });
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function state() {
  let config: TestPilotConfig;
  let configError: string | null = null;
  try {
    config = await loadConfig(CONFIG_FILE);
  } catch (err) {
    configError = (err as Error).message;
    // An unconfigured install should still render the UI, with defaults filled in.
    config = ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } });
  }

  const features = await listFeatures(config);
  const elements = await countElements(config);
  const reports = await listReports(config);
  const secrets = await Secrets.load();

  return {
    config,
    configError,
    configFile: path.resolve(CONFIG_FILE),
    features,
    elements,
    reports,
    runs: await recentRuns(),
    // Passwords are never sent to the browser — only the fact that one exists,
    // so the field can render a "đã lưu" placeholder instead of looking empty.
    accounts: config.accounts.map((a) => ({ ...a, hasPassword: secrets.has(a.label) })),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

async function listFeatures(cfg: TestPilotConfig) {
  if (!existsSync(cfg.paths.features)) return [];
  const files = (await readdir(cfg.paths.features)).filter((f) => f.endsWith('.feature')).sort();
  const registry = await Registry.load(cfg.paths.registry);
  return Promise.all(
    files.map(async (name) => {
      const uri = path.join(cfg.paths.features, name);
      const content = await readFile(uri, 'utf8');
      try {
        const spec = parseFeature(uri, content, registry);
        return {
          name,
          content,
          feature: spec.name,
          scenarios: spec.scenarios.map((s) => ({
            name: s.name,
            tags: s.tags,
            platforms: s.platforms,
            steps: s.steps.length,
          })),
          error: null as string | null,
        };
      } catch (err) {
        // Show the file anyway — a binding error is exactly what needs fixing.
        return { name, content, feature: name, scenarios: [], error: (err as Error).message };
      }
    }),
  );
}

async function countElements(cfg: TestPilotConfig): Promise<number> {
  const registry = await Registry.load(cfg.paths.registry);
  return Object.keys(registry.raw.elements).length;
}

/**
 * Every run, newest first — not one report per platform.
 *
 * The old version listed `reports/<platform>/index.html`, which could only ever
 * describe the most recent run of each platform because that path is fixed.
 * With hundreds of runs the interesting question is "what happened on the run
 * that failed", so the list is the runs themselves.
 */
async function listReports(cfg: TestPilotConfig) {
  const runs = await listRuns(cfg.paths.runs);
  return runs
    .filter((r) => existsSync(path.join(cfg.paths.runs, r.id, 'index.html')))
    .map((r) => ({
      id: r.id,
      platform: r.platform,
      status: r.status,
      kind: r.kind,
      startedAt: r.startedAt,
      ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
      ...(r.device ? { device: r.device } : {}),
      ...(r.tag ? { tag: r.tag } : {}),
      ...(r.counters ? { counters: r.counters } : {}),
      url: `/${[cfg.paths.runs, r.id, 'index.html'].join('/')}`,
    }));
}

async function mcpTools(cfg: unknown) {
  const bridge = await McpBridge.connect(cfg as Parameters<typeof McpBridge.connect>[0]);
  try {
    const tools = await bridge.listTools();
    return { tools, guess: guessToolNames(tools) };
  } finally {
    await bridge.close().catch(() => {});
  }
}

async function models() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { models: FALLBACK_MODELS, live: false, reason: 'ANTHROPIC_API_KEY chưa được set' };
  }
  try {
    const client = new Anthropic();
    const page = await client.models.list({ limit: 30 });
    const list = page.data.map((m) => ({ id: m.id, display_name: m.display_name }));
    return { models: list.length > 0 ? list : FALLBACK_MODELS, live: list.length > 0 };
  } catch (err) {
    return { models: FALLBACK_MODELS, live: false, reason: (err as Error).message };
  }
}

/* ------------------------------------------------------------------ */
/* Scenario Studio                                                     */
/* ------------------------------------------------------------------ */

/** Exactly the fields on the Scenario Studio card. */
interface StudioForm {
  sources?: string[];
  baseUrl?: string;
  targetFeature?: string;
  accounts?: Array<{
    label: string;
    username: string;
    password?: string;
    /** Label this row had when the form loaded, so a rename can carry its secret. */
    previousLabel?: string;
  }>;
  model?: string;
  note?: string;
}

/**
 * Folds the form into testpilot.config.json, and the passwords into the
 * separate secrets file. A password submitted as an empty string means "leave
 * the stored one alone" — the UI never receives the value back, so it cannot
 * echo it, and a plain save must not therefore wipe it.
 */
async function applyForm(form: StudioForm): Promise<TestPilotConfig> {
  const current = await loadConfig(CONFIG_FILE).catch(() =>
    ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }),
  );

  const accounts = (form.accounts ?? [])
    .filter((a) => a.label?.trim())
    .map((a) => ({ label: a.label.trim(), username: a.username ?? '' }));

  const draft = {
    ...current,
    sources: (form.sources ?? current.sources).filter((s) => s.trim()),
    targetFeature: form.targetFeature?.trim() ?? current.targetFeature,
    accounts,
    web: { ...current.web, baseUrl: form.baseUrl?.trim() || current.web.baseUrl },
    llm: {
      ...current.llm,
      model: form.model ?? current.llm.model,
      note: form.note ?? current.llm.note,
    },
  };

  const parsed = ConfigSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  await saveConfig(parsed.data, CONFIG_FILE);

  const secrets = await Secrets.load();
  for (const a of form.accounts ?? []) {
    const label = a.label?.trim();
    if (!label) continue;

    if (a.password) {
      secrets.set(label, a.password);
      continue;
    }
    // An empty password field means "leave it alone" — the value was never
    // sent to the browser, so it cannot be echoed back. When the label also
    // changed, "alone" has to follow the rename or the password is dropped on
    // the floor and the account silently stops working.
    const from = a.previousLabel?.trim();
    if (from && from !== label) {
      const carried = secrets.get(from);
      if (carried !== undefined) secrets.set(label, carried);
    }
  }
  secrets.keepOnly(accounts.map((a) => a.label));
  await secrets.save();

  return parsed.data;
}

/** The generation pipeline, streamed to the browser and recorded in history. */
async function runWorkflow(
  cfg: TestPilotConfig,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<void> {
  const history = await History.load();
  const run = history.start(cfg.targetFeature || 'generated', 'gen', GEN_STAGES);
  await history.save();
  stage(run);

  const record = (line: string) => {
    run.log.push(line);
    log(line);
  };

  try {
    await runGenPipeline(cfg, {
      log: record,
      stage: (index, status) => {
        const s = run.stages[index];
        if (s) s.status = status;
        stage(run);
        void history.save();
      },
    });
    run.status = 'passed';
  } catch (err) {
    run.status = 'failed';
    run.error = (err as Error).message;
    throw err;
  } finally {
    run.finishedAt = new Date().toISOString();
    stage(run);
    await history.save();
  }
}

/**
 * Passwords for the device, taken from the local secrets file so nobody has to
 * type them a second time into a config that gets committed.
 *
 * Gated on `farm.sendSecrets` because the testspec these end up in is uploaded
 * to S3 in plain text and kept with the run history. The log says which
 * accounts were sent — never the values — so the exposure is at least visible
 * in the run's own record.
 */

async function recentRuns() {
  const history = await History.load();
  return history.list().map((r) => ({ ...r, stagesDone: stagesDone(r) }));
}

/* ------------------------------------------------------------------ */
/* AWS Device Farm                                                     */
/* ------------------------------------------------------------------ */

function region(url: URL): string {
  return url.searchParams.get('region') || 'us-west-2';
}

/**
 * Every Device Farm call fails the same three ways — no credentials, wrong
 * region, missing IAM permission — and the raw SDK message is unhelpful for all
 * three. Returning a result object rather than throwing lets the page render
 * the fix inline instead of showing a 500.
 */
async function guarded<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, data: await fn() };
  } catch (err) {
    const message = (err as Error).message;
    return { ok: false as const, error: message, hint: awsHint(message) };
  }
}

function awsHint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('token') && (m.includes('expired') || m.includes('refresh'))) {
    // A new client is built per call, so a fresh SSO token is picked up without
    // restarting — unlike AWS_PROFILE, which is read from the process env.
    return 'Phiên SSO hết hạn. Chạy `aws sso login --profile <tên>` rồi bấm lại, không cần khởi động lại server.';
  }
  if (m.includes('could not load credentials') || m.includes('credential')) {
    return 'Chưa có AWS credential. Xem farm/iam-policy.json và chạy `aws configure sso` (hoặc `aws configure`), rồi khởi động lại server với AWS_PROFILE=<tên>.';
  }
  if (m.includes('not authorized') || m.includes('accessdenied')) {
    return 'Credential hợp lệ nhưng thiếu quyền devicefarm:List*/Create*/ScheduleRun.';
  }
  if (m.includes('region')) {
    return 'Device Farm chỉ có ở us-west-2. Project ở region khác sẽ không hiện.';
  }
  return '';
}

/** APK/IPA uploaded from the browser, parked next to the built test package. */
async function saveAppBinary(req: IncomingMessage, rawName: string) {
  // basename only, then a strict whitelist: this path is attacker-controlled.
  const name = path.basename(rawName);
  if (!/^[\w.-]+\.(apk|ipa)$/i.test(name)) {
    // Say *why*, per format. Device Farm's ANDROID_APP upload takes a plain
    // .apk — accepting a bundle here would only move the failure to the AWS
    // upload, which is a much worse place to discover it.
    const ext = path.extname(name).toLowerCase();
    const why: Record<string, string> = {
      '.xapk':
        'XAPK là định dạng đóng gói của bên thứ ba (APKPure…), Device Farm không nhận. ' +
        'Giải nén nó ra và lấy file .apk gốc bên trong.',
      '.aab':
        'AAB là Android App Bundle, Device Farm không cài trực tiếp được. ' +
        'Dựng universal APK: bundletool build-apks --mode=universal.',
      '.apks': 'File .apks của bundletool là bộ split APK — Device Farm cần một .apk đơn.',
      '.zip': 'Zip không phải app build. Nếu đây là XAPK đổi tên, giải nén lấy .apk bên trong.',
    };
    const hint = why[ext] ?? 'Chỉ nhận .apk (Android) hoặc .ipa (iOS), tên không có ký tự lạ.';
    return { ok: false, error: hint };
  }

  const dir = path.resolve('build');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);

  const MAX_BYTES = 1024 * 1024 * 1024;
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) return cb(new Error('File vượt quá 1 GB.'));
      cb(null, chunk);
    },
  });

  try {
    await pipeline(req, counter, createWriteStream(file));
  } catch (err) {
    await rm(file, { force: true });
    return { ok: false, error: (err as Error).message };
  }

  // Persist immediately. Uploading a build is an unambiguous intent to use it,
  // and holding the path only in the tab meant a page reload silently forgot a
  // 200 MB upload.
  const rel = path.relative(process.cwd(), file);
  const cfg = await loadConfig(CONFIG_FILE).catch(() => null);
  if (cfg) {
    cfg.farm.appPath = rel;
    cfg.farm.platform = name.toLowerCase().endsWith('.ipa') ? 'ios' : 'android';
    await saveConfig(cfg, CONFIG_FILE);
  }
  return { ok: true, path: rel, size };
}

/** The Device Farm form. Mirrors the config's `farm` block one-to-one. */
interface FarmForm {
  region?: string;
  projectArn?: string;
  devicePoolArn?: string;
  platform?: 'android' | 'ios';
  appPath?: string;
  testPackagePath?: string;
  testSpecPath?: string;
  runName?: string;
  jobTimeoutMinutes?: number;
  videoCapture?: boolean;
  sendSecrets?: boolean;
  env?: Record<string, string>;
  /** Rebuild the Appium zip before scheduling. */
  bundle?: boolean;
}

async function applyFarmForm(form: FarmForm): Promise<TestPilotConfig> {
  const current = await loadConfig(CONFIG_FILE).catch(() =>
    ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }),
  );

  const draft = {
    ...current,
    farm: {
      ...current.farm,
      ...Object.fromEntries(
        Object.entries(form).filter(([k, v]) => k !== 'bundle' && v !== undefined),
      ),
    },
  };

  const parsed = ConfigSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  await saveConfig(parsed.data, CONFIG_FILE);
  return parsed.data;
}

async function runOnFarm(
  cfg: TestPilotConfig,
  bundle: boolean,
  log: (line: string) => void,
  stage: (run: WorkflowRun) => void,
): Promise<void> {
  const history = await History.load();
  const run = history.start(
    cfg.farm.runName || `${cfg.farm.platform}-farm`,
    'farm',
    FARM_STAGES,
  );
  await history.save();
  stage(run);

  const record = (line: string) => {
    run.log.push(line);
    log(line);
  };
  /** Device Farm's stages are sequential, so entering one closes the previous. */
  const enter = (index: number) => {
    for (let i = 0; i < index; i++) {
      if (run.stages[i]!.status === 'running') run.stages[i]!.status = 'done';
    }
    if (run.stages[index]) run.stages[index]!.status = 'running';
    stage(run);
    // Persist on every transition. A farm run takes many minutes, and saving
    // only at the end left the history table reading "running 0/4" throughout —
    // indistinguishable from a job that never started.
    void history.save();
  };

  try {
    enter(0);
    if (bundle) {
      await spawnStep('npm', ['run', 'farm:bundle'], record);
    } else {
      record('Bỏ qua bước đóng gói — dùng lại zip có sẵn.');
    }

    const result = await scheduleFarmRun(
      // runs/ and not runs/<platform>/: the tree coming back from the device
      // already contains its own run directory, whose name carries the
      // platform. Joining a platform on here would nest it a second time.
      {
        ...cfg.farm,
        env: { ...cfg.farm.env, ...(await farmSecretEnv(cfg, record)) },
        runsDir: cfg.paths.runs,
        flakeDb: cfg.paths.flakeDb,
        reportsDir: cfg.paths.reports,
        retention: cfg.retention,
      },
      { log: record, stage: enter },
    );

    for (const s of run.stages) if (s.status === 'running') s.status = 'done';
    record(`status=${result.status} result=${result.result}`);
    record(`counters ${JSON.stringify(result.counters)}`);

    // Include the URL, not just the name. Device Farm keeps the video and the
    // logs on its side, and a name alone means digging through the AWS console
    // to find the one artifact that explains the failure. These are presigned
    // and expire in a few hours, which is why the log says so.
    const interesting = new Set(['VIDEO', 'TESTSPEC_OUTPUT', 'DEVICE_LOG', 'CUSTOMER_ARTIFACT']);
    const linked = result.artifacts.filter((a) => interesting.has(a.type));
    for (const a of linked.slice(0, 12)) record(`${a.type.padEnd(18)} ${a.name} → ${a.url}`);
    if (linked.length > 0) record('(link Device Farm là presigned, hết hạn sau vài giờ)');
    for (const a of result.artifacts.filter((a) => !interesting.has(a.type)).slice(0, 20)) {
      record(`${a.type.padEnd(18)} ${a.name}`);
    }

    run.status = result.result === 'PASSED' ? 'passed' : 'failed';
    if (result.result !== 'PASSED') run.error = `Device Farm trả về ${result.result}.`;
  } catch (err) {
    for (const s of run.stages) if (s.status === 'running') s.status = 'failed';
    run.status = 'failed';
    run.error = (err as Error).message;
    throw err;
  } finally {
    run.finishedAt = new Date().toISOString();
    stage(run);
    await history.save();
  }
}

function spawnStep(bin: string, args: string[], log: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${bin} ${args.join(' ')}`);
    const child = spawn(bin, args, { env: process.env });
    const pipe = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).forEach(log);
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} ${args.join(' ')} thoát với mã ${code}.`)),
    );
  });
}

/** Delegates to the CLI so the UI and a terminal run exactly the same code. */
function runSuite(
  platform: string,
  tag: string | undefined,
  headed: boolean,
  log: (l: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const bin = path.resolve('node_modules/.bin/tsx');
    const args = [
      'src/cli/run.ts',
      '--platform',
      platform,
      ...(tag ? ['--tag', tag] : []),
      ...(headed ? ['--headed'] : []),
    ];
    log(`$ tsx ${args.join(' ')}`);

    const child = spawn(bin, args, { env: process.env });
    const pipe = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).forEach(log);
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('close', (code) => {
      log(`\nTiến trình kết thúc với mã ${code}.`);
      // A non-zero exit is a test failure, not a UI failure — report, don't throw.
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Server-sent events over a POST, read by the client with a stream reader.
 * Two channels: `log` for console lines, `run` for the stage tracker that draws
 * the progress list and the "3/7" cell.
 */
async function stream(
  res: ServerResponse,
  job: (log: (l: string) => void, stage: (run: WorkflowRun) => void) => Promise<void>,
) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    await job(
      (line) => send('log', line),
      // The log array would double every frame; the client already has the lines.
      (run) => send('run', { ...run, log: undefined, stagesDone: stagesDone(run) }),
    );
    send('done', { ok: true });
  } catch (err) {
    send('error', (err as Error).message);
    send('done', { ok: false });
  }
  res.end();
}

/**
 * Serves a file, honouring HTTP Range.
 *
 * Range is what makes a video seekable. Without it the browser gets one opaque
 * 200 and the scrubber does nothing — which is how a two-minute recording of a
 * test run became something you had to watch from the beginning, every time,
 * including the ten seconds of Appium starting up.
 */
async function serveFile(res: ServerResponse, file: string, range?: string): Promise<void> {
  if (!existsSync(file)) return json(res, 404, { error: `Not found: ${file}` });
  const body = await readFile(file);
  const headers: Record<string, string> = {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    // The panel is edited while it is running and has no cache-busting build
    // step, so a cached index.html or app.js means staring at a stale UI and
    // wondering why a change did nothing. Correctness beats a warm cache on a
    // single-user local tool.
    'cache-control': 'no-store',
  };

  const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  if (match) {
    const [, rawStart, rawEnd] = match;
    const start = rawStart ? Number(rawStart) : undefined;
    const end = rawEnd ? Number(rawEnd) : undefined;
    // `bytes=-500` means the last 500 bytes, not "from 0 to 500".
    const from = start !== undefined ? start : Math.max(0, body.length - (end ?? 0));
    const to = start !== undefined ? Math.min(end ?? body.length - 1, body.length - 1) : body.length - 1;
    if (from > to || from >= body.length) {
      res.writeHead(416, { 'content-range': `bytes */${body.length}` });
      res.end();
      return;
    }
    const slice = body.subarray(from, to + 1);
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${from}-${to}/${body.length}`,
      'content-length': String(slice.length),
    });
    res.end(slice);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': String(body.length) });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}
