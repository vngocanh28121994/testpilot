import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, type TestPilotConfig } from '../config.js';
import { Registry } from '../core/registry.js';
import { Secrets, accountVariables, secretEnvName } from '../core/secrets.js';
import type { FeatureSpec, Platform, RunReport, ScenarioResult } from '../core/types.js';
import type { UiDriver } from '../drivers/driver.js';
import { Executor } from '../runtime/executor.js';
import { Resolver, DEFAULT_RESOLVE } from '../runtime/resolver.js';
import { ElementDiscovery } from '../discovery/ElementDiscovery.js';
import { RuntimeRegistry } from '../discovery/RuntimeRegistry.js';
import { AppiumMcpElementDiscovery } from '../discovery/mcp/AppiumMcpElementDiscovery.js';
import { DriverMcpClient } from '../discovery/mcp/DriverMcpClient.js';
import { parseFeature } from '../steps/binding.js';
import { FlakeDetector, collectHealSuggestions } from '../flaky/detector.js';
import { writeHtmlReport } from '../report/html.js';
import { linkLatest, prune, runDirFor, writeRunMeta } from '../core/runstore.js';

/**
 * Runs the whole suite on one platform. Web and native are separate invocations
 * on purpose: they have different lifecycles, different infrastructure, and one
 * should never be able to block the other from reporting.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config ?? 'testpilot.config.json');
  const platform = args.platform;

  const registry = await Registry.load(cfg.paths.registry);
  const features = await loadFeatures(cfg.paths.features, registry);
  const secrets = await Secrets.load();
  const variables = accountVariables(cfg.accounts, secrets);
  assertAccountsResolve(features, cfg, variables);

  // Fixed before anything runs, because the report, the screenshots and the
  // videos all have to land in the same directory for the run to be readable
  // later as one thing.
  const startedAt = new Date().toISOString();
  const runDir = runDirFor(cfg.paths.runs, startedAt, platform, args.tag);
  const artifactsDir = process.env.TESTPILOT_ARTIFACTS ?? path.join(runDir, 'artifacts');
  // Recorded up front so a crashed or killed process still leaves a row rather
  // than an unexplained directory.
  await writeRunMeta(runDir, {
    id: path.basename(runDir),
    platform,
    kind: args.onFarm ? 'farm' : 'run',
    ...(args.tag ? { tag: args.tag } : {}),
    status: 'running',
    startedAt,
  });

  const driver = await makeDriver(platform, cfg, args.onFarm, args.headed, artifactsDir);

  // Wire the discovery pipeline:
  //   DriverMcpClient → AppiumMcpElementDiscovery → ElementDiscovery → Resolver
  // DriverMcpClient bridges UiDriver.observe() into the McpClient interface so
  // AppiumMcpElementDiscovery can serve as the ObservationProvider for
  // ElementDiscovery.  When all registry candidates fail, Resolver calls
  // elementDiscovery.discover(), which observes the live UI via the driver and
  // runs DeterministicMatcher — closing the integration gap identified in the
  // audit (elementDiscovery was undefined in prior runs).
  const mcpClient = new DriverMcpClient(driver);
  const appiumMcp = new AppiumMcpElementDiscovery(mcpClient);
  const runtimeRegistry = await RuntimeRegistry.load('registry/runtime-registry.json');
  const elementDiscovery = new ElementDiscovery(appiumMcp, runtimeRegistry);

  const resolver = new Resolver(driver, registry, {
    ...DEFAULT_RESOLVE,
    timeoutMs: cfg.resolve.timeoutMs,
    pollMs: cfg.resolve.pollMs,
    verifyHealedMatch: cfg.resolve.verifyHealedMatch,
  }, elementDiscovery);
  const executor = new Executor(driver, resolver, {
    retries: cfg.executor.retries,
    verifyInput: cfg.executor.verifyInput,
    screenshotOnFailure: true,
    variables,
  });

  const flake = await FlakeDetector.load(cfg.paths.flakeDb, cfg.flake);
  const results: ScenarioResult[] = [];
  const quarantined: RunReport['quarantined'] = [];

  await driver.start();
  try {
    for (const feature of features) {
      for (const scenario of feature.scenarios) {
        if (!scenario.platforms.includes(platform)) continue;
        if (args.tag && !scenario.tags.includes(args.tag)) continue;

        if (flake.isQuarantined(scenario.id, platform, driver.device) && !args.includeQuarantined) {
          console.log(`[run] skip (quarantined) ${scenario.name}`);
          quarantined.push({
            id: scenario.id,
            name: scenario.name,
            platform,
            device: driver.device,
          });
          continue;
        }

        process.stdout.write(`[run] ${scenario.name} … `);
        const result = await executor.runScenario(scenario, feature.background);
        results.push(result);
        console.log(result.verdict);
      }
    }
  } finally {
    await driver.stop();
  }

  const verdicts = flake.ingest(results);
  await flake.save();
  await registry.save(); // persists healing telemetry, not locator changes

  const report: RunReport = {
    runId: randomUUID().slice(0, 8),
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    healSuggestions: collectHealSuggestions(registry, results),
    quarantined,
  };

  const out = await writeHtmlReport(report, verdicts, runDir);
  console.log(`[run] report -> ${out}`);

  // Flaky does not fail the build; a real failure does. Conflating the two is
  // how teams end up ignoring the whole suite.
  const realFailures = results.filter((r) => r.verdict === 'failed');

  await writeRunMeta(runDir, {
    id: path.basename(runDir),
    platform,
    kind: args.onFarm ? 'farm' : 'run',
    ...(args.tag ? { tag: args.tag } : {}),
    device: driver.device,
    status: realFailures.length > 0 ? 'failed' : 'passed',
    startedAt,
    finishedAt: report.finishedAt,
    counters: {
      total: results.length + quarantined.length,
      passed: results.filter((r) => r.verdict === 'passed').length,
      failed: realFailures.length,
      quarantined: quarantined.length,
    },
  });
  await linkLatest(cfg.paths.reports, platform, runDir);
  // Pruning after the report is written, never before: a crash during cleanup
  // must not be able to cost you the run you just did.
  const dropped = await prune(cfg.paths.runs, cfg.retention);
  if (dropped.length > 0) console.log(`[run] dọn ${dropped.length} run cũ theo retention.`);

  if (realFailures.length > 0) {
    console.error(`[run] ${realFailures.length} scenario(s) failed.`);
    process.exit(1);
  }
}

/**
 * The real device, when Device Farm says what it is.
 *
 * Otherwise the runner reports the placeholder from the config file — the same
 * string on every phone in the pool. The flake history is keyed on it, so a
 * scenario that is broken on one device and healthy on another would land in
 * one bucket and be classified as 50% flaky rather than broken on that device.
 * Device Farm exports this per job; the pull step also stamps it from the job
 * record, which is the authority when the two disagree.
 *
 * Used only as a label. It must never reach `appium:deviceName`, which is a
 * capability the server acts on — sending a real handset name there changed
 * what was asked of Appium and took a whole run with it.
 */
function farmDeviceName(): string | undefined {
  const name = process.env.DEVICEFARM_DEVICE_NAME?.trim();
  return name ? name : undefined;
}

/**
 * Both drivers are imported dynamically, and that is load-bearing rather than
 * stylistic. `scripts/bundle-farm.sh` strips Playwright from the Device Farm
 * package because the native run never uses it — but a static import of
 * drivers/web.js pulls the package into the module graph anyway, and the run
 * dies with ERR_MODULE_NOT_FOUND before a single test starts. Importing only
 * the driver the platform actually needs is what makes that stripping safe.
 */
async function makeDriver(
  platform: Platform,
  cfg: TestPilotConfig,
  onFarm: boolean,
  headed: boolean,
  artifactsDir: string,
): Promise<UiDriver> {
  if (platform === 'web') {
    const { WebUiDriver } = await import('../drivers/web.js');
    // --headed overrides the config so you can watch one run without editing
    // (and forgetting to revert) the file CI also reads.
    const headless = headed ? false : cfg.web.headless;
    return new WebUiDriver({
      baseUrl: cfg.web.baseUrl,
      headless,
      // Slow motion only matters when there is something to watch.
      ...(headless ? {} : { slowMoMs: cfg.web.slowMoMs }),
      device: cfg.web.device,
      record: cfg.web.record,
      ...(cfg.web.network ? { network: cfg.web.network } : {}),
      ...(cfg.web.popups ? { popups: cfg.web.popups } : {}),
      artifactsDir,
    });
  }

  // On Device Farm the Appium endpoint and device come from the container.
  const host = process.env.TESTPILOT_APPIUM_HOST ?? '127.0.0.1';
  const port = Number(process.env.TESTPILOT_APPIUM_PORT ?? 4723);
  const wdPath = process.env.TESTPILOT_APPIUM_PATH ?? '/';

  const { NativeUiDriver } = await import('../drivers/native.js');

  if (platform === 'android') {
    return new NativeUiDriver({
      platform: 'android',
      hostname: host,
      port,
      path: wdPath,
      deviceName: cfg.android.deviceName,
      ...(farmDeviceName() ? { reportedDevice: farmDeviceName()! } : {}),
      // The farm installs the app itself; passing `app` there is an error.
      ...(onFarm ? {} : cfg.android.app ? { app: cfg.android.app } : {}),
      ...(cfg.android.appPackage ? { appPackage: cfg.android.appPackage } : {}),
      ...(cfg.android.appActivity ? { appActivity: cfg.android.appActivity } : {}),
      hybrid: cfg.android.hybrid,
      isolation: cfg.android.isolation,
      artifactsDir,
    });
  }

  return new NativeUiDriver({
    platform: 'ios',
    hostname: host,
    port,
    path: wdPath,
    deviceName: cfg.ios.deviceName,
    ...(farmDeviceName() ? { reportedDevice: farmDeviceName()! } : {}),
    ...(onFarm ? {} : cfg.ios.app ? { app: cfg.ios.app } : {}),
    ...(cfg.ios.bundleId ? { bundleId: cfg.ios.bundleId } : {}),
    hybrid: cfg.ios.hybrid,
    artifactsDir,
  });
}

/**
 * Fails the run when a step references an account that does not exist.
 *
 * The executor deliberately leaves an unknown `{{...}}` placeholder in place so
 * the mistake shows up in a failure screenshot rather than as a silently blank
 * field. That works, but only if somebody looks: a scenario that merely types
 * into a form still passes with the literal `{{account.demo.username}}` sitting
 * in it. Renaming an account is exactly when this happens, so catch it here —
 * before a browser starts, and long before a paid device does.
 */
/**
 * Refuses to start unless every `{{account.*}}` in the suite has a value.
 *
 * It used to check only that the label existed in the config, which is a
 * different question and a much easier one to pass. A configured account with
 * no password reaching the runner sailed through this guard, and the app was
 * then handed the literal string `{{account.tcbs.password}}` as its password —
 * three Device Farm runs blamed on the login server before anyone looked here.
 * Checking the resolved value costs nothing and fails in a second, on a laptop,
 * instead of in three paid minutes on a device.
 */
function assertAccountsResolve(
  features: FeatureSpec[],
  cfg: TestPilotConfig,
  variables: Record<string, string>,
): void {
  const known = new Set(cfg.accounts.map((a) => a.label.trim().toLowerCase()));
  const unknownLabel = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();

  for (const feature of features) {
    for (const scenario of feature.scenarios) {
      for (const step of [...feature.background, ...scenario.steps]) {
        for (const match of step.text.matchAll(/\{\{\s*(account\.([\w-]+)\.[\w-]+)\s*\}\}/g)) {
          const [, name, label] = match;
          if (!name || !label) continue;
          const bucket = !known.has(label.toLowerCase())
            ? unknownLabel
            : variables[name] === undefined || variables[name] === ''
              ? unresolved
              : undefined;
          if (!bucket) continue;
          const key = bucket === unknownLabel ? label : name;
          const where = bucket.get(key) ?? [];
          if (!where.includes(scenario.name)) where.push(scenario.name);
          bucket.set(key, where);
        }
      }
    }
  }

  const where = (w: string[]) => w.slice(0, 3).join('; ');
  if (unknownLabel.size > 0) {
    const lines = [...unknownLabel].map(([l, w]) => `  - "${l}" dùng ở: ${where(w)}`);
    throw new Error(
      `Feature tham chiếu ${unknownLabel.size} account không tồn tại trong config:\n${lines.join('\n')}\n\n` +
        `Account hiện có: ${[...known].join(', ') || '(chưa có cái nào)'}.\n` +
        'Thêm vào Scenario Studio → Test Accounts, hoặc sửa tên trong .feature.',
    );
  }
  if (unresolved.size > 0) {
    const lines = [...unresolved].map(([n, w]) => `  - {{${n}}} dùng ở: ${where(w)}`);
    throw new Error(
      `${unresolved.size} biến account không có giá trị:\n${lines.join('\n')}\n\n` +
        'Mật khẩu đến từ .testpilot.secrets.json khi chạy máy local, hoặc từ biến môi trường\n' +
        `${secretEnvName('LABEL').replace('LABEL', '<label>')} khi chạy trên Device Farm — ` +
        'bật farm.sendSecrets để nó được gửi lên.\n' +
        'Không có nó, placeholder sẽ được gõ nguyên văn vào ô nhập.',
    );
  }
}

async function loadFeatures(dir: string, registry: Registry) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.feature')).sort();
  if (files.length === 0) throw new Error(`No .feature files in ${path.resolve(dir)}.`);
  return Promise.all(
    files.map(async (f) => {
      const uri = path.join(dir, f);
      return parseFeature(uri, await readFile(uri, 'utf8'), registry);
    }),
  );
}

interface Args {
  platform: Platform;
  config?: string;
  tag?: string;
  onFarm: boolean;
  includeQuarantined: boolean;
  /** Show the browser instead of running headless. Web only. */
  headed: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = (get('--platform') ?? 'web').toLowerCase();
  const platform =
    raw === 'android' || raw === 'ios' ? raw : raw === 'web' ? 'web' : undefined;
  if (!platform) throw new Error(`--platform must be web | android | ios (got "${raw}").`);

  return {
    platform,
    ...(get('--config') ? { config: get('--config')! } : {}),
    ...(get('--tag') ? { tag: get('--tag')! } : {}),
    onFarm: argv.includes('--on-farm'),
    includeQuarantined: argv.includes('--include-quarantined'),
    headed: argv.includes('--headed'),
  };
}

main().catch((err: Error) => {
  console.error(`[run] ${err.message}`);
  process.exit(1);
});
