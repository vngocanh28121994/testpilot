import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applyEnv,
  assertEnvPackage,
  deviceById,
  loadConfig,
  type DeviceSpec,
  type TestPilotConfig,
} from '../config.js';
import { Registry } from '../core/registry.js';
import { ScenarioReviewStore, scenarioBlocks } from '../core/scenarioReview.js';
import { KnownIssueStore } from '../core/knownIssues.js';
import { adoptStoredApiKeys, Secrets, accountVariables, secretEnvName } from '../core/secrets.js';
import { DeviceEnvLog, needsReinstall } from '../core/deviceEnv.js';
import { canonicalTag } from '../core/tagTaxonomy.js';
import type {
  FeatureSpec,
  OpenQuestion,
  Platform,
  RunReport,
  ScenarioResult,
  ScenarioSpec,
  StepSpec,
} from '../core/types.js';
import { proposeStepHypotheses } from '../healing/StepHealer.js';
import {
  healScenarioSteps,
  type ScenarioAttempt,
  type StepPatch,
} from '../healing/StepHealingLoop.js';
import type { UiDriver } from '../drivers/driver.js';
import { Executor } from '../runtime/executor.js';
import { Resolver, DEFAULT_RESOLVE } from '../runtime/resolver.js';
import { ElementDiscovery } from '../discovery/ElementDiscovery.js';
import { SemanticElementDiscovery } from '../discovery/ai/SemanticElementDiscovery.js';
import { LlmElementProvider } from '../discovery/ai/LlmElementProvider.js';
import { RuntimeRegistry } from '../discovery/RuntimeRegistry.js';
import { AppiumMcpElementDiscovery } from '../discovery/mcp/AppiumMcpElementDiscovery.js';
import { DriverMcpClient } from '../discovery/mcp/DriverMcpClient.js';
import { parseFeature } from '../steps/binding.js';
import { FlakeDetector } from '../flaky/detector.js';
import { HealingStore } from '../healing/HealingStore.js';
import { writeHtmlReport } from '../report/html.js';
import { linkLatest, prune, runDirFor, writeRunMeta } from '../core/runstore.js';
import { writeLearned } from '../core/learned.js';
import { generatePom } from '../pom/generator.js';

/**
 * Runs the whole suite on one platform. Web and native are separate invocations
 * on purpose: they have different lifecycles, different infrastructure, and one
 * should never be able to block the other from reporting.
 */
async function main(): Promise<void> {
  await adoptStoredApiKeys();
  const args = parseArgs(process.argv.slice(2));
  const baseCfg = await loadConfig(args.config ?? 'testpilot.config.json');
  // The farm container has no flags of its own; it gets the environment the
  // same way it gets passwords, through the environment it was launched with.
  const envName = args.env ?? process.env.TESTPILOT_ENV ?? baseCfg.defaultEnv;
  const { config: cfg, alias } = applyEnv(baseCfg, envName);
  const platform = args.platform;
  // Before anything is loaded, and before a device is touched. On Device Farm
  // the farm installs the package it was uploaded, so there is nothing here to
  // get wrong.
  if (!args.onFarm) assertEnvPackage(baseCfg, envName, platform);

  const registry = await Registry.load(cfg.paths.registry);
  const features = await loadFeatures(
    cfg.paths.features,
    registry,
    cfg.paths.scenarioReviewDb,
    args.feature,
  );
  // Printed before anything runs: a scenario dropped by the review gate is not
  // a result, and the operator has to see it while it can still be acted on.
  //
  // Chỉ những kịch bản LẼ RA ĐÃ CHẠY trong lượt này.
  //
  // Trước đây đây là toàn bộ kịch bản chưa duyệt của mọi feature, không lọc
  // theo tag lẫn nền tảng. Chọn chạy đăng nhập trên iOS thì nhận về mười ba
  // dòng về những feature khác, kèm một câu "13 kịch bản chưa duyệt nên không
  // được chạy" — đọc như thể lượt chạy vừa bị chặn, trong khi nó vẫn chạy bình
  // thường và mười ba kịch bản kia chưa bao giờ nằm trong phạm vi được hỏi.
  const wantedTags = args.tag ? args.tag.split(',').map(canonicalTag).filter(Boolean) : [];
  const inScope = (scenario: { tags: string[]; platforms: string[] }) =>
    scenario.platforms.includes(platform)
    && (wantedTags.length === 0 || wantedTags.some((tag) => scenario.tags.includes(tag)));

  const unapproved = features
    .flatMap((feature) => feature.unapproved)
    .filter(inScope)
    .map((scenario) => scenario.name);
  for (const name of unapproved) console.log(`[run:unapproved] ✎ ${name}`);
  if (unapproved.length > 0) {
    console.log(
      `[run] ${unapproved.length} kịch bản chưa duyệt nên không được chạy. `
      + 'Mở tab Kịch bản rồi bấm “Duyệt” để đưa vào lượt chạy.',
    );
  }

  // Deferred decisions, gathered while the run proceeds. Never blocks it.
  const openQuestions: OpenQuestion[] = [];

  const secrets = await Secrets.load();
  const variables = accountVariables(cfg.accounts, secrets, alias);
  assertAccountsResolve(features, cfg, variables, alias, envName);
  warnAboutLocatorlessElements(
    features,
    registry,
    platform,
    inScope,
    platform !== 'web' && Boolean(platform === 'ios' ? cfg.ios.hybrid : cfg.android.hybrid),
  );

  // Fixed before anything runs, because the report, the screenshots and the
  // videos all have to land in the same directory for the run to be readable
  // later as one thing.
  const startedAt = new Date().toISOString();
  const device = resolveDevice(cfg, platform, args);
  // Only a run that named a device suffixes its directory. Without --device
  // there is one process and nothing to collide with, so the name — which is
  // also the run id every store keys on — stays exactly as it has always been.
  const runDir = runDirFor(
    cfg.paths.runs,
    startedAt,
    platform,
    args.tag,
    args.device ? device.id : undefined,
  );
  // Báo LUÔN, không chỉ ở chế độ deferred.
  //
  // Lý do cũ — "in ra vô điều kiện chỉ thêm một dòng chẳng ai cần" — không còn
  // đúng: server đọc dòng này để biết ghi log.txt vào đâu NGAY TRONG LÚC chạy,
  // thay vì chỉ ghi một lần lúc kết thúc. Nhờ vậy một trang vừa tải lại nối lại
  // được, và một lượt chạy bị giết giữa chừng vẫn còn log để đọc.
  //
  // Giao diện vẫn ẩn dòng này (LogView.tsx), nên người dùng không thấy gì khác.
  console.log(`[run:dir] ${runDir}`);
  const artifactsDir = process.env.TESTPILOT_ARTIFACTS ?? path.join(runDir, 'artifacts');
  // Recorded up front so a crashed or killed process still leaves a row rather
  // than an unexplained directory.
  await writeRunMeta(runDir, {
    id: path.basename(runDir),
    platform,
    ...(Object.keys(baseCfg.environments).length > 0 ? { env: envName } : {}),
    kind: args.onFarm ? 'farm' : 'run',
    ...(args.tag ? { tag: args.tag } : {}),
    status: 'running',
    startedAt,
  });

  // Which build is on the handset, and whether this run has to change it.
  // Only local native runs: web has no package, and on Device Farm the farm
  // installs whatever it was uploaded and this process cannot second-guess it.
  const envLog = await DeviceEnvLog.load(cfg.paths.deviceEnvDb);
  const appUnderTest = platform === 'ios' ? cfg.ios.app : platform === 'android' ? cfg.android.app : undefined;
  // Only when environments exist. A config that declares none has exactly one
  // build, so there is nothing to be on the wrong side of — and printing a line
  // about environments there is noise in every run that never asked.
  const tracksEnv =
    platform !== 'web' &&
    !args.onFarm &&
    Boolean(device.udid) &&
    Object.keys(baseCfg.environments).length > 0;
  const decision = tracksEnv
    ? needsReinstall(envLog.get(device.udid!), envName, appUnderTest, envName === baseCfg.defaultEnv)
    : { reinstall: false, because: '' };
  const enforceAppInstall = decision.reinstall || (tracksEnv && args.reinstall);
  if (tracksEnv) {
    console.log(
      enforceAppInstall
        ? `[run:env] ${envName} — cài lại app (${args.reinstall && !decision.reinstall ? '--reinstall' : decision.because})`
        : `[run:env] ${envName} — ${decision.because}`,
    );
  }

  const driver = await makeDriver(
    platform,
    cfg,
    args.onFarm,
    args.headed,
    artifactsDir,
    device,
    enforceAppInstall,
  );

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

  // The AI tier is built only when the config asks for it and a vendor key is
  // present. Absent either, the resolver is byte-for-byte the deterministic one
  // — no network call can enter a run that did not opt in.
  const semanticDiscovery = cfg.discovery.ai.enabled && LlmElementProvider.available()
    ? new SemanticElementDiscovery(new LlmElementProvider(), runtimeRegistry)
    : undefined;
  if (cfg.discovery.ai.enabled && !semanticDiscovery) {
    console.warn('[discovery:ai] đã bật trong config nhưng chưa có API key — bỏ qua tầng AI.');
  }

  const resolver = new Resolver(driver, registry, {
    ...DEFAULT_RESOLVE,
    timeoutMs: cfg.resolve.timeoutMs,
    pollMs: cfg.resolve.pollMs,
    verifyHealedMatch: cfg.resolve.verifyHealedMatch,
  }, elementDiscovery, semanticDiscovery, cfg.discovery.ai.minConfidence);
  const executor = new Executor(driver, resolver, {
    retries: args.locatorRetries ?? cfg.executor.retries,
    verifyInput: cfg.executor.verifyInput,
    screenshotOnFailure: true,
    variables,
  });

  const flake = await FlakeDetector.load(cfg.paths.flakeDb, cfg.flake);
  const healing = await HealingStore.load(cfg.paths.healingDb);
  await healing.backfill(cfg.paths.runs);
  const results: ScenarioResult[] = [];
  const quarantined: RunReport['quarantined'] = [];

  try {
    await driver.start();
  } catch (err) {
    throw new Error(explainDriverStart(err as Error, platform));
  }
  // Written only now: before start() the install has not happened, and a failed
  // session must not leave a claim about the device that nothing put there.
  if (tracksEnv && enforceAppInstall && appUnderTest) {
    // Only what this process actually installed. Recording an assumption is
    // how the log would start lying about handsets nobody touched.

    envLog.set(device.udid!, envName, appUnderTest);
    await envLog.save();
  }
  try {
    featureLoop: for (const feature of features) {
      for (const scenario of feature.scenarios) {
        // Cùng một predicate với chỗ báo "chưa duyệt" ở trên: hai định nghĩa
        // của "kịch bản này có thuộc lượt chạy không" là hai cách trôi khỏi nhau.
        if (!inScope(scenario)) continue;

        if (flake.isQuarantined(scenario.id, platform, driver.device) && !args.includeQuarantined) {
          console.log(`[run:skip] ⊘ ${scenario.name}`);
          quarantined.push({
            id: scenario.id,
            name: scenario.name,
            platform,
            device: driver.device,
          });
          continue;
        }

        console.log(`[run:running] … ${scenario.name}`);
        let result = await executor.runScenario(scenario, feature.background);
        result = await attemptStepHealing(
          result, scenario, feature.background, executor, registry, openQuestions);
        results.push(result);
        const icon = result.verdict === 'passed' ? '✓' : result.verdict === 'flaky' ? '~' : '✗';
        console.log(`[run:${result.verdict}] ${icon} ${scenario.name}`);

        const failedStep = result.runs.at(-1)?.steps.find((step) => step.status === 'failed');
        if (failedStep?.failureKind === 'environment') {
          console.error(
            '[run:abort] Lỗi setup/môi trường không thể được locator healing xử lý; ' +
              'dừng các scenario còn lại để tránh lặp lại cùng một lỗi.',
          );
          break featureLoop;
        }
      }
    }
  } finally {
    await driver.stop();
    // Discovery may have minted selectors for natural-language elements even
    // when a later step fails. Keep that verified work for the next run.
    if (args.deferSharedWrites) {
      // Every one of these stores is written by rewriting the whole file, so
      // concurrent runs would each erase what the others found. Leave the files
      // alone and hand the learnings to whoever is coordinating the run; see
      // mergeRunLearnings(). Flakiness and healing are not written here at all
      // because both are derived from `results`, which report.json already holds.
      await writeLearned(runDir, {
        registry: registry.changesSinceLoad(),
        runtime: runtimeRegistry.raw,
      });
    } else {
      await runtimeRegistry.save();
      await registry.save();
    }
  }

  const verdicts = flake.ingest(results);
  flake.ingestSkipped(quarantined.map((q) => ({ id: q.id, platform, device: q.device })));
  if (!args.deferSharedWrites) await flake.save();

  // Locator reliability is historical, just like flakiness. Ingest this run
  // after backfilling retained reports, then snapshot the accumulated proposal
  // set into this report so it stays readable even if telemetry changes later.
  healing.ingest(path.basename(runDir), results, new Date().toISOString());
  if (!args.deferSharedWrites) await healing.save();

  const report: RunReport = {
    runId: randomUUID().slice(0, 8),
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    // The run report is an immutable snapshot. Cross-run proposals belong to
    // Healing Center; this report renders its own step.heal events directly.
    healSuggestions: [],
    ...(openQuestions.length > 0 ? { openQuestions } : {}),
    quarantined,
  };

  // Kịch bản đỏ vì sản phẩm chưa đáp ứng, không phải vì test hỏng.
  //
  // Nhãn gắn với đúng nội dung kịch bản lúc người ta xem xét, nên một kịch bản
  // đã bị sửa sẽ không còn được nhãn cũ bảo lãnh — nó quay về đỏ thật.
  const known = await KnownIssueStore.load(cfg.paths.knownIssuesDb);

  // Nhãn đi vào report để nó phân biệt được "đã gắn" với "gắn được": không có
  // dữ liệu này thì lời mời gắn nhãn trông y hệt một cái nhãn đã gắn.
  const knownById = new Map(
    results
      .map((r) => {
        const issue = r.scenario.contentHash
          ? known.active(r.scenario.id, r.scenario.contentHash)
          : undefined;
        return issue ? ([r.scenario.id, issue.note] as const) : null;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null),
  );
  const out = await writeHtmlReport(report, verdicts, runDir, knownById);

  const isKnown = (r: (typeof results)[number]) =>
    r.verdict === 'failed'
    && Boolean(r.scenario.contentHash)
    && Boolean(known.active(r.scenario.id, r.scenario.contentHash!));

  // Nhãn đã cũ thì nói ra, đừng lặng lẽ bỏ qua: người gắn nó cần biết vì sao
  // kịch bản của mình đột nhiên đỏ trở lại.
  for (const r of results) {
    const stale = r.scenario.contentHash
      ? known.stale(r.scenario.id, r.scenario.contentHash)
      : undefined;
    if (stale) {
      console.log(
        `[run] "${r.scenario.name}" từng được gắn Known issue, nhưng nội dung kịch bản đã đổi `
        + 'kể từ đó nên nhãn hết hiệu lực. Xem lại rồi gắn lại nếu vẫn đúng.',
      );
    }
  }

  // Xanh trở lại thì mời gỡ nhãn. Một nhãn không ai gỡ sẽ che mất đúng cái ngày
  // sản phẩm được sửa xong.
  for (const r of results) {
    if (r.verdict !== 'passed' || !r.scenario.contentHash) continue;
    if (known.active(r.scenario.id, r.scenario.contentHash)) {
      console.log(
        `[run] "${r.scenario.name}" đang mang nhãn Known issue nhưng đã PASS. `
        + 'Nếu sản phẩm đã sửa xong thì gỡ nhãn đi.',
      );
    }
  }

  // Summary table ─ parsed by the UI to render a result block
  const knownIssues = results.filter(isKnown);
  const passed = results.filter((r) => r.verdict === 'passed').length;
  const failed = results.filter((r) => r.verdict === 'failed' && !isKnown(r)).length;
  const flaky  = results.filter((r) => r.verdict === 'flaky').length;
  // The unapproved count is part of the headline, not a footnote: without a
  // denominator "6✓ 0✗" reads the same whether one scenario was skipped or none
  // existed at all.
  console.log(
    `[run:summary] ${passed}✓ ${failed}✗ ${flaky}~ ${quarantined.length}⊘`
    + (unapproved.length > 0 ? ` ${unapproved.length}✎` : '')
    // ⚠ đứng cuối và chỉ hiện khi có: hai bộ phân tích dòng này đều neo vào
    // phần đầu, nên chèn vào giữa sẽ làm chúng ngừng đọc được cả dòng.
    + (knownIssues.length > 0 ? ` ${knownIssues.length}⚠` : ''),
  );

  console.log(`[run] report -> ${out}`);

  // Flaky does not fail the build; a real failure does. Conflating the two is
  // how teams end up ignoring the whole suite.
  // Known issue không làm hỏng lượt chạy: nó là chuyện của sản phẩm, và một
  // suite đỏ vĩnh viễn là một suite không ai còn đọc.
  const realFailures = results.filter((r) => r.verdict === 'failed' && !isKnown(r));
  if (knownIssues.length > 0) {
    console.log(`[run] ${knownIssues.length} kịch bản đỏ vì sản phẩm chưa đáp ứng (Known issue):`);
    for (const r of knownIssues) {
      const note = known.active(r.scenario.id, r.scenario.contentHash!)?.note;
      console.log(`  ⚠ ${r.scenario.name}${note ? ` — ${note}` : ''}`);
    }
  }

  // Approved features define the reusable API; a successful local execution
  // confirms the runtime registry behind that API. Incremental generation only
  // appends missing methods and never overwrites hand-written Page Object code.
  if (!args.onFarm && realFailures.length === 0 && results.length > 0) {
    try {
      const pom = await generatePom(features, registry.raw, {
        outputDir: 'generated',
        platform,
      });
      const added = Object.values(pom.changes.pageMethodsAdded).flat();
      const created = pom.changes.pagesCreated;
      if (added.length > 0 || created.length > 0) {
        console.log(
          `[pom] tái sử dụng: ${created.length} page mới, ${added.length} method mới được bổ sung.`,
        );
      }
      // The scaffold is written once and kept, which is right — someone may have
      // edited it — but it can then go on naming a platform nobody runs.
      const stale = pom.changes.driverPlatformStale;
      if (stale) {
        console.warn(
          `[pom] generated/support/driver.ts đang mặc định platform "${stale.existing}" ` +
            `trong khi run này là "${stale.current}". Chạy spec sinh ra sẽ mở "${stale.existing}" ` +
            'trừ khi đặt TESTPILOT_PLATFORM. Sửa file đó, hoặc chạy: npm run pom -- ' +
            `--platform ${stale.current} --overwrite-driver`,
        );
      }
    } catch (err) {
      // POM projection is secondary to the authoritative run report. A
      // generation problem must be visible, but must not turn a passed suite
      // into a failed suite.
      console.warn(`[pom] chưa đồng bộ được POM: ${(err as Error).message}`);
    }
  }

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
  // Exit 2: nothing failed, but the run was not complete. Kept distinct from 1
  // because "a test broke" and "a test never ran" call for different actions,
  // and collapsing them loses that exactly when it matters. Automation that
  // only checks for zero still treats this as a failure, which is the safe
  // default for a suite that silently skipped part of itself.
  if (unapproved.length > 0) {
    console.error(
      `[run] ${unapproved.length} kịch bản chưa duyệt nên không được chạy — lượt chạy không đầy đủ.`,
    );
    process.exit(2);
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
/**
 * The real handset's UDID on Device Farm.
 *
 * Without it, XCUITest has no device to attach to and quietly falls back to a
 * Simulator — then fails looking for an SDK the host does not have
 * ("'26.2' does not exist in the list of simctl SDKs"). The message says
 * nothing about the phone sitting there unused, which is the actual problem.
 *
 * Android needs no equivalent: UiAutomator2 attaches to the single adb device.
 */
function farmDeviceUdid(): string | undefined {
  return process.env.DEVICEFARM_DEVICE_UDID?.trim() || undefined;
}

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
  device: DeviceSpec,
  enforceAppInstall: boolean,
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
      // Session state is a credential-equivalent local fixture. Never create
      // or consume it in a remote/farm worker or place it under the run dir.
      persistAuthSessions: !onFarm,
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
      deviceName: device.deviceName,
      ...(device.udid ? { udid: device.udid } : {}),
      ...(device.systemPort ? { systemPort: device.systemPort } : {}),
      // On Android the udid is the adb serial, and every `adb` call this driver
      // makes needs `-s` once a second handset is attached.
      ...(device.udid ? { deviceSerial: device.udid } : {}),
      ...(farmDeviceName() ? { reportedDevice: farmDeviceName()! } : {}),
      // The farm installs the app itself; passing `app` there is an error.
      ...(onFarm ? {} : cfg.android.app ? { app: cfg.android.app } : {}),
      ...(enforceAppInstall ? { enforceAppInstall: true } : {}),
      ...(cfg.android.appPackage ? { appPackage: cfg.android.appPackage } : {}),
      ...(cfg.android.appActivity ? { appActivity: cfg.android.appActivity } : {}),
      hybrid: cfg.android.hybrid,
      ...(cfg.android.webviewTimeoutMs ? { webviewTimeoutMs: cfg.android.webviewTimeoutMs } : {}),
      isolation: cfg.android.isolation,
      ...(cfg.web.popups ? { popupRules: cfg.web.popups } : {}),
      artifactsDir,
    });
  }

  return new NativeUiDriver({
    platform: 'ios',
    hostname: host,
    port,
    path: wdPath,
    deviceName: farmDeviceName() ?? device.deviceName,
    ...((device.udid ?? farmDeviceUdid())
      ? { udid: (device.udid ?? farmDeviceUdid())! }
      : {}),
    ...(device.wdaLocalPort ? { wdaLocalPort: device.wdaLocalPort } : {}),
    ...(farmDeviceName() ? { reportedDevice: farmDeviceName()! } : {}),
    ...(onFarm ? {} : cfg.ios.app ? { app: cfg.ios.app } : {}),
    ...(enforceAppInstall ? { enforceAppInstall: true } : {}),
    ...(cfg.ios.bundleId ? { bundleId: cfg.ios.bundleId } : {}),
    // Signing only matters on a real device, and Device Farm signs for us.
    ...(!onFarm && cfg.ios.teamId ? { teamId: cfg.ios.teamId } : {}),
    ...(!onFarm && cfg.ios.teamId ? { signingId: cfg.ios.signingId } : {}),
    ...(!onFarm && cfg.ios.wdaBundleId ? { wdaBundleId: cfg.ios.wdaBundleId } : {}),
    hybrid: cfg.ios.hybrid,
    ...(cfg.ios.webviewTimeoutMs ? { webviewTimeoutMs: cfg.ios.webviewTimeoutMs } : {}),
    ...(cfg.web.popups ? { popupRules: cfg.web.popups } : {}),
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
/**
 * Name the elements a scenario will reach for and never find.
 *
 * An element with no candidates and no history is not necessarily wrong —
 * runtime discovery can still locate it, and a supplied locator library is
 * loaded before the scenarios that use it exist. But when a generated scenario
 * picks the empty twin of a control that already has a proven locator under a
 * different name, every step touching it fails, and the only way to learn that
 * today is to watch an eleven-minute workflow go red. Two seconds and a list of
 * names is a better trade. Deliberately a warning, not an error: refusing to
 * run would block the very first run of any newly authored element.
 */
/**
 * Try to work out the step a failing scenario is missing.
 *
 * Runs only where a scenario failed *and* an earlier step ran clean without
 * proving anything — that combination is the signature of a missing action, and
 * it is what a whole day of manual debugging eventually came down to here.
 * Scenarios that pass are left alone however many unverified steps they carry:
 * three of them in this suite are permanently unverifiable and perfectly
 * correct, and "fixing" those would insert junk into work that already runs.
 *
 * Nothing is written. A verified patch is reported for a human to apply, and an
 * unresolved one becomes a question. The re-runs are the only thing that can
 * tell a real fix from a plausible one.
 */
async function attemptStepHealing(
  result: ScenarioResult,
  scenario: ScenarioSpec,
  background: StepSpec[],
  executor: Executor,
  registry: Registry,
  openQuestions: OpenQuestion[],
): Promise<ScenarioResult> {
  const last = result.runs.at(-1);
  const observation = last?.healingObservation;
  if (result.verdict !== 'failed' || !observation) return result;

  const known = new Set(Object.keys(registry.raw.elements));
  console.log(
    `[heal:step] "${scenario.name}": dòng ${observation.unverifiedLine} chạy xong mà không `
    + `chứng minh được gì, dòng ${observation.failingLine} fail — thử tìm bước còn thiếu.`,
  );

  const outcome = await healScenarioSteps({
    scenario: scenario.name,
    baseline: toAttempt(last!),
    knownElementIds: known,
    propose: async () => proposeStepHypotheses({
      priorTaps: observation.priorTaps,
      visibleNow: observation.visibleNow,
      failingElementId: stepElementAt(last!, observation.unverifiedLine) ?? '',
    }),
    runPatched: async (patches: StepPatch[]) => {
      const attempt = await executor.runScenario(scenario, background, patches);
      return toAttempt(attempt.runs.at(-1)!);
    },
  });

  if (outcome.kind === 'healed') {
    console.log(`[heal:step] ✓ tìm được bước còn thiếu cho "${scenario.name}":`);
    for (const patch of outcome.patches) {
      console.log(`    sau dòng ${patch.afterLine}: ${patch.step}`);
      console.log(`      lý do: ${patch.reason}`);
    }
    console.log(
      '    Kịch bản chạy lại đã xanh. Thêm bước trên vào file .feature rồi duyệt lại để áp dụng.',
    );
  } else if (outcome.kind === 'question') {
    // Recorded, not asked. The run carries on; the report carries the question.
    openQuestions.push({
      source: 'healing',
      prompt: outcome.question.prompt,
      reason: outcome.question.rationale,
      options: outcome.question.options,
      scenario: scenario.name,
      line: observation.unverifiedLine,
    });
    console.log(`[heal:step] ? ghi vào báo cáo, không chặn lượt chạy: "${scenario.name}"`);
  } else if (outcome.kind === 'exhausted') {
    console.log(`[heal:step] ✗ không tìm được bước còn thiếu: ${outcome.reason}`);
  }
  // The verdict is not rewritten. A patch that only exists in memory did not
  // fix the suite, and reporting the scenario as passing would be a lie until
  // somebody applies it.
  return result;
}

function toAttempt(run: ScenarioResult['runs'][number]): ScenarioAttempt {
  return {
    passed: run.status === 'passed',
    steps: run.steps.map((s) => ({
      line: s.step.line,
      text: s.step.text,
      status: s.status,
      isTap: s.step.intent.kind === 'tap',
      ...('element' in s.step.intent ? { elementId: s.step.intent.element } : {}),
    })),
  };
}

function stepElementAt(run: ScenarioResult['runs'][number], line: number): string | undefined {
  const step = run.steps.find((s) => s.step.line === line);
  return step && 'element' in step.step.intent ? step.step.intent.element : undefined;
}

/**
 * Biến lỗi khởi động driver thành câu nói được phải làm gì.
 *
 * `xcodebuild failed with code 65` là câu Appium ném ra cho MỌI thứ hỏng quanh
 * WebDriverAgent, và tự nó không chỉ được chỗ nào. Người dùng thấy vòng lặp
 * cài app → cài WDA → app biến mất → lặp lại, và không có gì trong log nói vì
 * sao.
 *
 * Trên máy vừa gặp lỗi, đào ra thì: build KÝ THÀNH CÔNG, cả hai app đều đã nằm
 * trên điện thoại — hỏng ở khâu CHẠY. Với profile của Apple ID miễn phí (hạn 7
 * ngày), iOS từ chối chạy app cho tới khi nhà phát triển được tin cậy trên
 * chính máy đó. Appium thất bại rồi thử lại, thành đúng vòng lặp ấy.
 *
 * Không đoán bừa: chỉ thêm hướng dẫn cho đúng mã lỗi này, và giữ nguyên câu
 * gốc bên dưới để ai cần vẫn tra được.
 */
function explainDriverStart(err: Error, platform: Platform): string {
  if (platform !== 'ios' || !/xcodebuild failed with code 65/i.test(err.message)) {
    return err.message;
  }
  return (
    'Không khởi động được WebDriverAgent trên iPhone (xcodebuild code 65).\n\n'
    + 'Thường gặp nhất: chứng chỉ nhà phát triển chưa được tin cậy TRÊN MÁY.\n'
    + '  Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị › mục Ứng dụng nhà phát triển\n'
    + '  → chọn chứng chỉ → Tin cậy. Rồi chạy lại.\n\n'
    + 'Nếu đã tin cậy rồi thì kiểm tiếp: máy phải mở khoá trong lúc chạy, và\n'
    + 'profile của Apple ID miễn phí chỉ có hạn 7 ngày — hết hạn thì phải build lại.\n\n'
    + `Nguyên văn lỗi: ${err.message}`
  );
}

function warnAboutLocatorlessElements(
  features: FeatureSpec[],
  registry: Registry,
  platform: Platform,
  /**
   * Chỉ cảnh báo về kịch bản THUỘC lượt chạy này.
   *
   * Trước đây nó duyệt mọi feature, nên chạy đăng nhập trên iOS lại nhận một
   * cảnh báo về `priceBoard.floorTabs` — element chỉ dùng ở một kịch bản của
   * feature thêm-mã-cổ-phiếu, thứ chưa bao giờ nằm trong phạm vi được hỏi.
   * Cảnh báo về việc mình không yêu cầu là cách nhanh nhất để người ta ngừng
   * đọc cảnh báo.
   */
  inScope: (scenario: { tags: string[]; platforms: string[] }) => boolean,
  /** App chạy trong WebView: candidate `web` dùng được cho cả nền tảng native. */
  hybrid: boolean,
): void {
  const offenders = new Map<string, { label: string; where: string[] }>();
  for (const feature of features) {
    for (const scenario of feature.scenarios) {
      if (!inScope(scenario)) continue;
      for (const step of scenario.steps) {
        const intent = step.intent as { element?: string };
        if (!intent.element) continue;
        const element = registry.raw.elements[intent.element];
        if (!element) continue;
        // App hybrid chạy trong WebView, và `NativeUiDriver.platform` trả về
        // 'web' khi đang ở trong đó (native.ts:216). Nên một element chỉ có
        // candidate `web` VẪN dùng được trên iOS/Android hybrid — đòi cho bằng
        // được candidate `ios` là cảnh báo về một thứ không hỏng.
        //
        // Đây không phải trường hợp hiếm: phần lớn element của bộ này là
        // web-only, và chúng chạy tốt trên Android hybrid suốt.
        const usable = hybrid
          ? [...(element.candidates[platform] ?? []), ...(element.candidates.web ?? [])]
          : (element.candidates[platform] ?? []);
        if (usable.length > 0) continue;
        if ((element.health?.resolutions ?? 0) > 0) continue;
        const entry = offenders.get(intent.element)
          ?? { label: element.label, where: [] };
        const at = `${scenario.name}:${step.line}`;
        if (!entry.where.includes(at)) entry.where.push(at);
        offenders.set(intent.element, entry);
      }
    }
  }
  if (offenders.size === 0) return;
  console.warn(
    `[run] ${offenders.size} element chưa có locator ${platform} và chưa từng resolve — `
    + 'các bước dùng chúng nhiều khả năng sẽ fail:',
  );
  for (const [id, { label, where }] of offenders) {
    console.warn(`  ✗ "${label}" (${id}) — ${where.slice(0, 3).join(', ')}`);
  }
  console.warn(
    '  Nếu control này đã tồn tại dưới tên khác, hãy thêm tên đang dùng vào "aliases" '
    + 'của element đó thay vì để hai element cho một control.',
  );
}

function assertAccountsResolve(
  features: FeatureSpec[],
  cfg: TestPilotConfig,
  variables: Record<string, string>,
  alias: Record<string, string> = {},
  envName = '',
): void {
  // Once environments exist, every account a feature asks for must go through
  // the environment's mapping — including one whose name happens to match a
  // label. Anything unmapped falls back to the *label* of that name, which is
  // some other environment's account: a `sit` run that quietly logs in with the
  // prod user, fails at a screen three steps later, and blames the app. A
  // missing mapping is one line to add and says exactly which line; a silent
  // cross-environment login costs an afternoon.
  const referenced = new Set<string>();
  for (const feature of features) {
    for (const scenario of feature.scenarios) {
      for (const step of [...feature.background, ...scenario.steps]) {
        if (step.intent.kind === 'ensureLoggedIn') {
          referenced.add(step.intent.account.toLowerCase());
        }
        for (const m of step.text.matchAll(/\{\{\s*account\.([\w-]+)\.[\w-]+\s*\}\}/g)) {
          if (m[1]) referenced.add(m[1].toLowerCase());
        }
      }
    }
  }
  const unmapped =
    Object.keys(cfg.environments).length > 0
      ? [...referenced].filter((r) => alias[r] === undefined)
      : [];
  if (unmapped.length > 0) {
    throw new Error(
      `Environment "${envName}" chưa gán account cho vai trò: ${unmapped.join(', ')}.\n` +
        'Feature xin vai trò này, và khi đã khai báo environments thì mọi vai trò phải\n' +
        'được gán rõ ràng — bỏ trống sẽ âm thầm dùng account trùng tên của môi trường khác.\n' +
        'Mở Scenario Studio → Môi trường để gán.',
    );
  }

  // Roles count as known names even when no account carries that label: a
  // feature is written against `{{account.tcbs.*}}` the role, and the
  // environment is what turns it into a label.
  const known = new Set([
    ...cfg.accounts.map((a) => a.label.trim().toLowerCase()),
    ...Object.keys(alias).map((r) => r.trim().toLowerCase()),
  ]);
  const labels = new Set(cfg.accounts.map((a) => a.label.trim().toLowerCase()));
  const dangling = Object.entries(alias).filter(
    ([, label]) => !labels.has(label.trim().toLowerCase()),
  );
  if (dangling.length > 0) {
    throw new Error(
      `Environment trỏ tới account không tồn tại:\n` +
        dangling.map(([r, l]) => `  - vai trò "${r}" → label "${l}"`).join('\n') +
        `\n\nAccount hiện có: ${[...labels].join(', ') || '(chưa có cái nào)'}.`,
    );
  }

  const unknownLabel = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();

  for (const feature of features) {
    for (const scenario of feature.scenarios) {
      for (const step of [...feature.background, ...scenario.steps]) {
        if (step.intent.kind === 'ensureLoggedIn') {
          const label = step.intent.account;
          for (const field of ['username', 'password']) {
            const name = `account.${label}.${field}`;
            const bucket = !known.has(label.toLowerCase())
              ? unknownLabel
              : variables[name] === undefined || variables[name] === ''
                ? unresolved
                : undefined;
            if (!bucket) continue;
            const key = bucket === unknownLabel ? label : name;
            const locations = bucket.get(key) ?? [];
            if (!locations.includes(scenario.name)) locations.push(scenario.name);
            bucket.set(key, locations);
          }
        }
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

async function loadFeatures(
  dir: string,
  registry: Registry,
  reviewPath: string,
  featureFile?: string,
) {
  const all = (await readdir(dir)).filter((f) => f.endsWith('.feature')).sort();
  const files = featureFile ? all.filter((file) => file === featureFile) : all;
  if (featureFile && files.length === 0) {
    throw new Error(`Không tìm thấy feature được workflow tạo: ${featureFile}.`);
  }
  if (files.length === 0) throw new Error(`No .feature files in ${path.resolve(dir)}.`);
  const reviews = await ScenarioReviewStore.load(reviewPath);
  const features = await Promise.all(
    files.map(async (f) => {
      const uri = path.join(dir, f);
      const content = await readFile(uri, 'utf8');
      const feature = parseFeature(uri, content, registry);
      reviews.syncFile(f, content, { defaultStatus: 'approved', source: 'legacy' });
      const hashes = new Map(scenarioBlocks(content).map((block) => [block.name, block.contentHash]));
      const approved = feature.scenarios
        .filter((scenario) => reviews.isApproved(f, scenario.name, hashes.get(scenario.name)))
        .map((scenario) => ({ ...scenario, contentHash: hashes.get(scenario.name) }));
      // Names of what was dropped, not just how many. A scenario that silently
      // leaves the run is indistinguishable from one that passed, and the ones
      // that get dropped are exactly the ones just edited — the likeliest to be
      // broken. The caller prints these so the summary can never imply a
      // scenario ran when it did not.
      const approvedNames = new Set(approved.map((scenario) => scenario.name));
      // Giữ nguyên kịch bản, không chỉ tên: chỗ in ra phải lọc được theo đúng
      // tag và nền tảng của lượt chạy, mà tên trần thì không đủ để làm việc đó.
      const unapproved = feature.scenarios.filter((scenario) => !approvedNames.has(scenario.name));
      return { ...feature, scenarios: approved, unapproved };
    }),
  );
  await reviews.save();
  if (features.every((feature) => feature.scenarios.length === 0)) {
    throw new Error(
      'Không có kịch bản đã được duyệt để chạy. Mở tab Kịch bản, xem/sửa testcase rồi bấm “Duyệt”.',
    );
  }
  return features;
}

interface Args {
  platform: Platform;
  config?: string;
  tag?: string;
  onFarm: boolean;
  includeQuarantined: boolean;
  /** Show the browser instead of running headless. Web only. */
  headed: boolean;
  /**
   * Which entry of `<platform>.devices` to drive. Omitted for a single-device
   * suite, which is every config that has not opted into a device list.
   */
  device?: string;
  /**
   * Leave the shared stores alone and write this run's learnings beside its
   * report instead, for a coordinator to fold in afterwards. Set by a parallel
   * run, where several processes would otherwise overwrite each other's files.
   */
  deferSharedWrites: boolean;
  /** Which environment to run against; see config.environments. */
  env?: string;
  /** Run only this generated feature file; used by the Studio workflow. */
  feature?: string;
  /** Extra attempts allowed only for failures classified as locator failures. */
  locatorRetries?: number;
  /** Reinstall the app even when the device is already on this environment. */
  reinstall: boolean;
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

  const device = get('--device');
  // Silently ignoring one of these would mean a run that looks targeted and is
  // not, so say so instead. The farm supplies its own handset; see resolveDevice.
  if (device && argv.includes('--on-farm')) {
    throw new Error('--device cannot be combined with --on-farm: Device Farm assigns the handset.');
  }

  return {
    platform,
    ...(get('--config') ? { config: get('--config')! } : {}),
    ...(get('--tag') ? { tag: get('--tag')! } : {}),
    onFarm: argv.includes('--on-farm'),
    includeQuarantined: argv.includes('--include-quarantined'),
    headed: argv.includes('--headed'),
    deferSharedWrites: argv.includes('--defer-shared-writes'),
    reinstall: argv.includes('--reinstall'),
    ...(get('--env') ? { env: get('--env')! } : {}),
    ...(get('--feature') ? { feature: path.basename(get('--feature')!) } : {}),
    ...(get('--locator-retries')
      ? { locatorRetries: Math.max(0, Math.min(2, Number(get('--locator-retries')) || 0)) }
      : {}),
    ...(device ? { device } : {}),
  };
}

/**
 * The device this process drives.
 *
 * On Device Farm the container decides: the handset is whatever the farm
 * allocated, so a local `devices` list must not reach it — a udid from a
 * developer's desk asks a farm container for a phone that is not there. There,
 * the platform's plain `deviceName` stays the only capability sent, exactly as
 * before this flag existed.
 */
function resolveDevice(cfg: TestPilotConfig, platform: Platform, args: Args): DeviceSpec {
  if (args.onFarm) {
    const deviceName =
      platform === 'web' ? cfg.web.device
      : platform === 'ios' ? cfg.ios.deviceName
      : cfg.android.deviceName;
    return { id: platform, deviceName };
  }
  return deviceById(cfg, platform, args.device);
}

main().catch((err: Error) => {
  console.error(`[run] ${err.message}`);
  process.exit(1);
});
