/**
 * Offline self-test: exercises binding -> resolving -> healing -> flake
 * classification -> report against a fake driver. No browser, no device, no LLM.
 *
 *   npx tsx scripts/smoke.ts
 *
 * It is the fastest way to tell whether a change to the runtime broke the parts
 * that matter, and it runs in CI where no device is available.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Registry } from '../src/core/registry.js';
import type { ElementRegistry, LocatorCandidate, Platform, RunReport } from '../src/core/types.js';
import type { UiDriver, UiHandle } from '../src/drivers/driver.js';
import { NativeUiDriver, domSelector, pickWebviewContext } from '../src/drivers/native.js';
import { deviceSlug } from '../src/farm/devicefarm.js';
import {
  FRAGILE_BELOW,
  candidatesFor,
  elementId,
  type Observed,
} from '../src/crawl/observe.js';
import { Executor } from '../src/runtime/executor.js';
import { Resolver } from '../src/runtime/resolver.js';
import { parseFeature } from '../src/steps/binding.js';
import { FlakeDetector, collectHealSuggestions } from '../src/flaky/detector.js';
import { writeHtmlReport } from '../src/report/html.js';
import { listRuns, prune, runDirName, writeRunMeta } from '../src/core/runstore.js';

const REGISTRY: ElementRegistry = {
  version: 1,
  screens: { login: { id: 'login', title: 'Login' } },
  elements: {
    'login.email': {
      id: 'login.email',
      label: 'Email field',
      screen: 'login',
      candidates: {
        web: [{ strategy: 'testId', value: 'login-email', weight: 0.95, origin: 'authored' }],
      },
    },
    'login.submitButton': {
      id: 'login.submitButton',
      label: 'Login button',
      screen: 'login',
      candidates: {
        // The primary testId is stale on purpose — the resolver must heal to #2.
        web: [
          { strategy: 'testId', value: 'login-submit-OLD', weight: 0.95, origin: 'authored' },
          {
            strategy: 'role',
            value: 'button',
            name: 'Login button',
            weight: 0.8,
            origin: 'authored',
          },
        ],
      },
    },
    'login.welcome': {
      id: 'login.welcome',
      label: 'Welcome banner',
      screen: 'login',
      candidates: {
        web: [{ strategy: 'testId', value: 'welcome', weight: 0.9, origin: 'authored' }],
      },
    },
  },
};

const FEATURE = `@smoke
Feature: Login

  Background:
    Given I open the app

  @web
  Scenario: Successful login
    When I enter "{{account.maker.username}}" into "Email field"
    And I tap "Login button"
    Then "Welcome banner" is visible
    And "Welcome banner" shows "Welcome"
`;

/** Answers only to the locators a healthy app would expose today. */
class FakeDriver implements UiDriver {
  readonly platform: Platform = 'web';
  readonly device = 'fake';
  private live = new Set(['login-email', 'button:Login button', 'welcome']);
  calls: string[] = [];
  /** What each field ended up holding, so value() can report it back. */
  readonly fields = new Map<string, string>();
  /** Simulates a field that appends instead of replacing — the real bug. */
  appendOnInput = false;
  /** How long the typed value takes to show up, as it does through a WebView. */
  inputLagMs = 0;
  private landsAt = new Map<string, number>();

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async launch(): Promise<void> {
    this.calls.push('launch');
  }

  async find(c: LocatorCandidate): Promise<UiHandle | null> {
    const key = c.strategy === 'role' ? `${c.value}:${c.name}` : c.value;
    if (!this.live.has(key)) return null;
    const text = key === 'welcome' ? 'Welcome back' : (c.name ?? c.value);
    return {
      candidate: c,
      isVisible: async () => true,
      text: async () => text,
      value: async () => {
        if (!this.fields.has(key)) return null;
        // Still in flight: the field exists but has not caught up yet.
        return Date.now() < (this.landsAt.get(key) ?? 0) ? '' : this.fields.get(key)!;
      },
    };
  }

  async tap(h: UiHandle): Promise<void> {
    this.calls.push(`tap:${h.candidate.strategy}=${h.candidate.value}`);
  }
  async longPress(): Promise<void> {}
  async input(h: UiHandle, text: string): Promise<void> {
    this.calls.push(`input:${h.candidate.value}=${text}`);
    const key = h.candidate.value;
    this.fields.set(key, this.appendOnInput ? (this.fields.get(key) ?? '') + text : text);
    this.landsAt.set(key, Date.now() + this.inputLagMs);
  }
  async clear(): Promise<void> {}
  async selectOption(): Promise<void> {}
  async scrollIntoView(): Promise<void> {}
  async swipe(): Promise<void> {}
  async scroll(): Promise<void> {}
  async back(): Promise<void> {}
  async screenshot(name: string): Promise<string> {
    return `/dev/null/${name}.png`;
  }
  async isIdle(): Promise<boolean> {
    return true;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok — ${msg}`);
}

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'testpilot-smoke-'));
  const registryPath = path.join(dir, 'elements.json');
  await writeFile(registryPath, JSON.stringify(REGISTRY), 'utf8');
  const registry = await Registry.load(registryPath);

  console.log('binding');
  const feature = parseFeature('smoke.feature', FEATURE, registry);
  assert(feature.scenarios.length === 1, 'one scenario parsed');
  assert(feature.background.length === 1, 'background bound');
  const scenario = feature.scenarios[0]!;
  assert(scenario.platforms.join() === 'web', '@web tag restricted the scenario to web');
  assert(scenario.steps[0]!.intent.kind === 'input', 'first step bound to an input intent');
  assert(
    scenario.steps[1]!.intent.kind === 'tap' &&
      scenario.steps[1]!.intent.element === 'login.submitButton',
    'label "Login button" resolved to the element id',
  );

  console.log('execution + healing');
  const driver = new FakeDriver();
  const executor = new Executor(
    driver,
    new Resolver(driver, registry, {
      timeoutMs: 1000,
      pollMs: 50,
      requireVisible: true,
      verifyHealedMatch: true,
    }),
    {
      retries: 1,
      screenshotOnFailure: true,
      variables: { 'account.maker.username': 'qa@example.com' },
    },
  );
  await driver.start();
  const result = await executor.runScenario(scenario, feature.background);
  await driver.stop();

  assert(result.verdict === 'passed', 'scenario passed despite the stale primary locator');
  const healed = result.runs[0]!.steps.filter((s) => s.status === 'healed');
  assert(healed.length === 1, 'exactly one step reported a heal');
  assert(
    healed[0]!.heal?.to.strategy === 'role',
    'healed onto the role locator, not something unrelated',
  );
  assert(
    driver.calls.includes('tap:role=button'),
    'the tap actually went through the healed locator',
  );
  assert(
    driver.calls.includes('input:login-email=qa@example.com'),
    'the {{account}} placeholder was substituted before reaching the driver',
  );
  assert(
    result.runs[0]!.steps[1]!.step.text.includes('{{account.maker.username}}'),
    'the reported step text keeps the placeholder, so no credential reaches the report',
  );

  console.log('hybrid WebView locators');
  const dom = (c: Partial<LocatorCandidate>) =>
    domSelector({ strategy: 'label', value: '', weight: 1, origin: 'authored', ...c } as LocatorCandidate);

  assert(
    dom({ strategy: 'testId', value: 'login-submit' }).includes('[data-testid="login-submit"]'),
    'testId maps to the data-testid attribute Playwright also uses',
  );
  assert(
    dom({ strategy: 'placeholder', value: 'Email' }) === '[placeholder="Email"]',
    'placeholder maps to the placeholder attribute',
  );
  assert(
    dom({ strategy: 'role', value: 'button' }).includes('self::button'),
    'role=button also matches the <button> tag that implies it',
  );
  assert(
    dom({ strategy: 'label', value: 'Mật khẩu' }).includes('not(*)'),
    'label text matching is restricted to leaf nodes, so <body> cannot match',
  );
  assert(
    dom({ strategy: 'css', value: '.btn' }) === '.btn',
    'css passes through untouched — it is native-only that has no equivalent',
  );
  // XPath 1.0 has no escape character: a literal is quoted with whichever kind
  // the value lacks, and only a value holding both kinds needs concat().
  assert(
    dom({ strategy: 'label', value: "Nhà đầu tư's" }).includes(`"Nhà đầu tư's"`),
    'an apostrophe-only value is wrapped in double quotes',
  );
  assert(
    dom({ strategy: 'label', value: 'Ông "A"' }).includes(`'Ông "A"'`),
    'a double-quote-only value is wrapped in single quotes',
  );
  assert(
    dom({ strategy: 'label', value: `Ông "A"'s` }).includes('concat('),
    'a value holding both quote kinds falls back to an XPath concat()',
  );
  let threw = false;
  try {
    dom({ strategy: 'predicate', value: 'type == "XCUIElementTypeButton"' });
  } catch {
    threw = true;
  }
  assert(threw, 'the iOS-only predicate strategy is rejected inside a WebView');

  // Both naming schemes are real: Appium renames the context to WEBVIEW_<package>
  // unless enableWebviewDetailsCollection is off, in which case it stays
  // WEBVIEW_<pid>. The driver turns that option off, so it must accept both.
  assert(
    pickWebviewContext(['NATIVE_APP', 'WEBVIEW_31978']) === 'WEBVIEW_31978',
    'a pid-named WebView context is selected',
  );
  assert(
    pickWebviewContext(['NATIVE_APP', 'WEBVIEW_com.fss.tcbs.mobiletrading']) ===
      'WEBVIEW_com.fss.tcbs.mobiletrading',
    'a package-named WebView context is selected',
  );
  assert(
    pickWebviewContext(['NATIVE_APP']) === undefined,
    'a native-only app yields no WebView context rather than picking NATIVE_APP',
  );
  assert(
    pickWebviewContext(['NATIVE_APP', 'CHROMIUM']) === 'CHROMIUM',
    'the CHROMIUM context a system browser exposes is also accepted',
  );

  console.log('crawler locator ranking');
  const obs = (o: Partial<Observed>): Observed =>
    ({ interactive: true, index: 0, container: false, ...o }) as Observed;

  assert(
    candidatesFor(obs({ testId: 'login-submit', text: 'ĐĂNG NHẬP' }), 'web')[0]!.strategy ===
      'testId',
    'a test id outranks visible text',
  );
  assert(
    candidatesFor(obs({ role: 'button', name: 'Gửi', text: 'Gửi' }), 'web')[0]!.strategy === 'role',
    'role plus accessible name outranks bare text',
  );
  // The exact bug that made a button tap land in the middle of the page: the
  // wrapper carries every string inside it, so text must not address it.
  assert(
    !candidatesFor(obs({ role: 'View', text: 'cả trang gộp lại', container: true }), 'android')
      .some((c) => c.strategy === 'label'),
    'a container never gets a text locator',
  );
  assert(
    candidatesFor(obs({ role: 'android.widget.EditText' }), 'android')[0]!.value.includes(
      'instance(0)',
    ),
    'an unlabelled native field falls back to a position',
  );
  assert(
    candidatesFor(obs({ role: 'android.widget.EditText' }), 'android')[0]!.weight < FRAGILE_BELOW,
    'a position locator is weighted below the fragile threshold, so the crawl flags it',
  );
  assert(
    candidatesFor(obs({ role: 'input' }), 'web').length === 0,
    'web never falls back to a position — a missing handle there is a real gap',
  );
  // Icon fonts put their glyph name in innerText; `vpn_key` is not a label.
  assert(
    !candidatesFor(obs({ role: 'span', text: 'vpn_key' }), 'web').some((c) => c.strategy === 'label'),
    'an icon ligature is not mistaken for visible text',
  );
  assert(
    candidatesFor(obs({ role: 'span', text: 'Quên mật khẩu' }), 'web').some((c) => c.strategy === 'label'),
    'real prose still becomes a text locator',
  );
  // A structural path is not in the same class of durability as an id.
  assert(
    candidatesFor(obs({ role: 'div', css: '#submit' }), 'web')[0]!.weight >= FRAGILE_BELOW,
    'an id-based css selector counts as durable',
  );
  assert(
    candidatesFor(obs({ role: 'div', css: 'div > div:nth-of-type(2)' }), 'web')[0]!.weight <
      FRAGILE_BELOW,
    'a structural css path is flagged fragile — it breaks on the next wrapper div',
  );
  assert(
    elementId('login', obs({ placeholder: 'Số tài khoản' })) === 'login.soTaiKhoan',
    'ids are derived from what the element is, and stay ASCII',
  );
  const ordered = candidatesFor(
    obs({ testId: 't', role: 'button', name: 'n', placeholder: 'p', text: 'x' }),
    'web',
  );
  assert(
    ordered.every((c, i) => i === 0 || ordered[i - 1]!.weight >= c.weight),
    'candidates come out sorted strongest first, which is the order the resolver heals through',
  );

  console.log('flake classification');
  const flake = await FlakeDetector.load(path.join(dir, 'flake.json'), {
    window: 30,
    minRuns: 2,
    quarantineAt: 0.15,
    brokenAt: 0.95,
  });
  flake.ingest([result]);
  const verdicts = flake.ingest([{ ...result, verdict: 'flaky' }]);
  assert(verdicts[0]!.runs === 2, 'history accumulated across runs');
  assert(verdicts[0]!.shouldQuarantine, 'a 50% flake rate over the window triggers quarantine');
  assert(!verdicts[0]!.brokenNotFlaky, 'a flaky scenario is not classified as broken');

  console.log('report');
  const report: RunReport = {
    runId: 'smoke',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    results: [result],
    healSuggestions: collectHealSuggestions(registry, [result], 1),
    quarantined: [],
  };
  assert(report.healSuggestions.length === 1, 'heal suggestion produced for review');
  const file = await writeHtmlReport(report, verdicts, path.join(dir, 'report'));
  console.log(`  report -> ${file}`);

  console.log('input verification');
  {
    const mkExec = (drv: FakeDriver, verify: boolean) =>
      new Executor(
        drv,
        new Resolver(drv, registry, {
          timeoutMs: 1000,
          pollMs: 50,
          requireVisible: true,
          verifyHealedMatch: true,
        }),
        {
          retries: 0,
          screenshotOnFailure: false,
          verifyInput: verify,
          variables: { 'account.maker.username': 'maker@example.com' },
        },
      );

    // A field that keeps what the previous scenario left in it and appends —
    // exactly what put a 24-character password under a 14-character one.
    const bad = new FakeDriver();
    bad.appendOnInput = true;
    bad.fields.set('login-email', 'rác-từ-scenario-trước');
    await bad.start();
    const failed = await mkExec(bad, true).runScenario(scenario, feature.background);
    await bad.stop();
    assert(failed.verdict === 'failed', 'a field that did not take the value fails the step');
    const step = failed.runs[0]!.steps.find((x) => x.status === 'failed');
    assert(
      /Ô nhập không nhận đúng giá trị/.test(step?.error?.message ?? ''),
      'the error names the real cause instead of a later locator timeout',
    );

    // The same run with verification off is the old behaviour: green, wrongly.
    const quiet = new FakeDriver();
    quiet.appendOnInput = true;
    quiet.fields.set('login-email', 'rác-từ-scenario-trước');
    await quiet.start();
    const lied = await mkExec(quiet, false).runScenario(scenario, feature.background);
    await quiet.stop();
    assert(lied.verdict === 'passed', 'without verification the same broken run still reports green');

    // The step text is `{{account.maker.username}}`, so the value reaching the
    // field is a secret. The message it produces is written to the report, the
    // run log and the terminal, and must name none of them.
    const secret = 'S3cret-Passw0rd!';
    const leaky = new FakeDriver();
    leaky.appendOnInput = true;
    leaky.fields.set('login-email', 'giá-trị-cũ');
    await leaky.start();
    const leakRun = await new Executor(
      leaky,
      new Resolver(leaky, registry, {
        timeoutMs: 1000,
        pollMs: 50,
        requireVisible: true,
        verifyHealedMatch: true,
      }),
      {
        retries: 0,
        screenshotOnFailure: false,
        verifyInput: true,
        variables: { 'account.maker.username': secret },
      },
    ).runScenario(scenario, feature.background);
    await leaky.stop();
    const msg = leakRun.runs[0]!.steps.find((x) => x.status === 'failed')?.error?.message ?? '';
    assert(msg !== '', 'the secret-bearing step still fails');
    assert(!msg.includes(secret), 'the error never quotes the secret that was typed');
    assert(!msg.includes('giá-trị-cũ'), 'nor the field contents, which may also be a secret');
    assert(/\d+ ký tự/.test(msg), 'it reports lengths, which is enough to diagnose');

    // A field that needs a moment to reflect what was typed — a WebView on a
    // cold-started app. Reading once caught exactly this mid-flight and failed
    // a step whose value did arrive.
    const slow = new FakeDriver();
    slow.inputLagMs = 700;
    await slow.start();
    const late = await mkExec(slow, true).runScenario(scenario, feature.background);
    await slow.stop();
    assert(late.verdict === 'passed', 'a value that arrives late is waited for, not failed');

    // A variable with no value is an error, not a placeholder to type verbatim.
    // Getting this wrong put the literal "{{account.tcbs.password}}" into a
    // login form and cost three Device Farm runs of blaming the server.
    const noVars = new FakeDriver();
    await noVars.start();
    const bare = await new Executor(
      noVars,
      new Resolver(noVars, registry, {
        timeoutMs: 1000,
        pollMs: 50,
        requireVisible: true,
        verifyHealedMatch: true,
      }),
      { retries: 0, screenshotOnFailure: false },
    ).runScenario(scenario, feature.background);
    await noVars.stop();
    const bareMsg = bare.runs[0]!.steps.find((x) => x.status === 'failed')?.error?.message ?? '';
    assert(bare.verdict === 'failed', 'an unresolved variable fails the step');
    assert(/Không giải được biến/.test(bareMsg), 'and says which variable, not something downstream');
    assert(
      !noVars.calls.some((c) => c.includes('{{')),
      'the placeholder is never typed into the field',
    );

    // A clean field passes, so verification is not simply failing everything.
    const good = new FakeDriver();
    await good.start();
    const ok = await mkExec(good, true).runScenario(scenario, feature.background);
    await good.stop();
    assert(ok.verdict === 'passed', 'a field that took the value still passes');
  }

  console.log('native app foregrounding');
  {
    // A server that supports none of the foregrounding commands — which is
    // exactly what AWS Device Farm's Appium build does.
    // Annotated because it is only ever mutated inside a callback, which
    // leaves TypeScript narrowing it to the literal it was initialised with.
    let calls: number = 0;
    const deaf = new NativeUiDriver({
      platform: 'android',
      deviceName: 'fake',
      appPackage: 'com.example.app',
      appActivity: '.Main',
      artifactsDir: path.join(dir, 'native'),
      hybrid: false,
    });
    (deaf as unknown as { browser: unknown }).browser = {
      execute: async (command: string) => {
        calls++;
        throw new Error(`Unknown mobile command "${command}".`);
      },
      deleteSession: async () => {},
    };
    await deaf.launch();
    const probed = calls;
    assert(probed > 1, 'the first launch probes the alternatives rather than giving up');
    await deaf.launch();
    await deaf.launch();
    assert(calls === probed, 'later scenarios reuse the answer instead of re-probing');

    // A server where the second alternative works: the winner is remembered,
    // so the loser is not paid for again.
    calls = 0;
    const picky = new NativeUiDriver({
      platform: 'android',
      deviceName: 'fake',
      appPackage: 'com.example.app',
      appActivity: '.Main',
      artifactsDir: path.join(dir, 'native'),
      hybrid: false,
    });
    (picky as unknown as { browser: unknown }).browser = {
      execute: async (command: string) => {
        calls++;
        if (command === 'mobile: activateApp') throw new Error('Unknown mobile command.');
      },
      deleteSession: async () => {},
    };
    await picky.launch();
    const afterProbe = calls;
    assert(afterProbe === 2, 'probing stops at the first command that works');
    await picky.launch();
    const afterReplay = calls;
    assert(afterReplay === 3, 'the working command is replayed directly on the next scenario');

    // Re-attach a live browser after the session ends: if the cache survived,
    // the next launch would replay one command instead of probing again.
    await picky.stop();
    (picky as unknown as { browser: unknown }).browser = {
      execute: async (command: string) => {
        calls++;
        if (command === 'mobile: activateApp') throw new Error('Unknown mobile command.');
      },
      deleteSession: async () => {},
    };
    await picky.launch();
    const afterReset = calls;
    assert(afterReset === 5, 'a new session re-probes rather than trusting the old one');
  }

  {
    // Isolation: the app is force-stopped before each scenario, and a server
    // that refuses `mobile: shell` degrades to no isolation instead of failing.
    const calls: string[] = [];
    const mk = (opts: { isolation: 'restart' | 'none' }) =>
      new NativeUiDriver({
        platform: 'android',
        deviceName: 'fake',
        appPackage: 'com.example.app',
        appActivity: '.Main',
        artifactsDir: path.join(dir, 'native'),
        hybrid: false,
        ...opts,
      });

    const iso = mk({ isolation: 'restart' });
    (iso as unknown as { browser: unknown }).browser = {
      execute: async (command: string) => void calls.push(command),
      deleteSession: async () => {},
    };
    await iso.launch();
    await iso.launch();
    assert(
      calls.filter((c) => c === 'mobile: shell').length === 2,
      'every scenario force-stops the app, not just the first',
    );
    assert(
      calls.indexOf('mobile: shell') < calls.indexOf('mobile: activateApp'),
      'the kill happens before the relaunch, or the relaunch is what gets killed',
    );

    const off = mk({ isolation: 'none' });
    const offCalls: string[] = [];
    (off as unknown as { browser: unknown }).browser = {
      execute: async (command: string) => void offCalls.push(command),
      deleteSession: async () => {},
    };
    await off.launch();
    assert(!offCalls.includes('mobile: shell'), 'isolation: none leaves the app alone');

    // An Appium started without --allow-insecure=adb_shell.
    const deafShell = mk({ isolation: 'restart' });
    let shellTries = 0;
    let relaunches = 0;
    (deafShell as unknown as { browser: unknown }).browser = {
      execute: async (command: string) => {
        if (command === 'mobile: shell') {
          shellTries++;
          throw new Error('adb_shell insecure feature is not enabled');
        }
        relaunches++;
      },
      deleteSession: async () => {},
    };
    await deafShell.launch();
    await deafShell.launch();
    await deafShell.launch();
    assert(shellTries === 1, 'a refused shell is asked for once, not once per scenario');
    assert(relaunches === 3, 'the run continues without isolation rather than dying');
  }

  console.log('nhiều thiết bị');
  {
    // Every device in a pool produces a run directory named by the same
    // timestamp and platform. Without the device in the name they overwrite
    // each other and a three-phone run reports one phone.
    const a = `2026-08-09T01-00-00Z-android-${deviceSlug('Google Pixel 7')}`;
    const b = `2026-08-09T01-00-00Z-android-${deviceSlug('Samsung Galaxy S21')}`;
    assert(a !== b, 'two devices in one run get two directories, not one overwritten twice');
    assert(a === '2026-08-09T01-00-00Z-android-google-pixel-7', 'the slug is readable in a terminal');
    assert(deviceSlug('Xiaomi Redmi Note 12 (5G)') === 'xiaomi-redmi-note-12-5g', 'punctuation is dropped');
    assert(deviceSlug('***') === 'device', 'a name with nothing usable still yields a directory');

    // A device writes only its own bucket. Merging must respect that, or the
    // last job in a pool overwrites the others with the shared starting point.
    const deviceDb = {
      scenarios: {
        'scn::android::Google Pixel 7': { outcomes: ['p', 'p'] },
        'scn::android::Samsung Galaxy S21': { outcomes: ['f'] },
        'scn::web::Pixel 7': { outcomes: ['p'] },
      },
    };
    const mineOnly = Object.keys(deviceDb.scenarios).filter((k) =>
      k.endsWith('::Google Pixel 7'),
    );
    assert(
      mineOnly.length === 1 && mineOnly[0] === 'scn::android::Google Pixel 7',
      'a job contributes only the entries for the device it ran on',
    );

    // The label must not leak into the capability: the Appium server acts on
    // appium:deviceName, and a reporting change has no business altering it.
    const labelled = new NativeUiDriver({
      platform: 'android',
      deviceName: 'Android Device',
      reportedDevice: 'Google Pixel 8a (Android 17)',
      artifactsDir: path.join(dir, 'native'),
      hybrid: false,
    });
    assert(
      labelled.device === 'Google Pixel 8a (Android 17)',
      'reports and the flake key use the real device name',
    );
    assert(
      (labelled as unknown as { opts: { deviceName: string } }).opts.deviceName === 'Android Device',
      'the Appium capability is left exactly as configured',
    );

    // The flake window is keyed on the device, so the same scenario failing on
    // one phone and passing on another must not average into "50% flaky".
    const flake2 = await FlakeDetector.load(path.join(dir, 'flake-devices.json'), {
      window: 30,
      minRuns: 2,
      quarantineAt: 0.15,
      brokenAt: 0.95,
    });
    const on = (device: string, status: 'passed' | 'failed') => ({
      ...result,
      device,
      verdict: status,
      runs: [{ ...result.runs[0]!, status }],
    });
    flake2.ingest([on('Pixel 7', 'passed'), on('Galaxy S21', 'failed')]);
    flake2.ingest([on('Pixel 7', 'passed'), on('Galaxy S21', 'failed')]);
    const v = flake2.ingest([on('Pixel 7', 'passed'), on('Galaxy S21', 'failed')]);
    const pixel = v.find((x) => x.device === 'Pixel 7');
    const galaxy = v.find((x) => x.device === 'Galaxy S21');
    assert(!pixel?.shouldQuarantine, 'the healthy device is not quarantined for the other one\'s failures');
    assert(galaxy?.brokenNotFlaky === true, 'the broken device is called broken, not flaky');
  }

  console.log('run store retention');
  const runsRoot = path.join(dir, 'runs');
  const day = 86_400_000;
  const seed = async (ago: number, platform: string, status: 'passed' | 'failed' | 'running') => {
    const startedAt = new Date(Date.now() - ago).toISOString();
    const id = runDirName(startedAt, platform);
    await writeRunMeta(path.join(runsRoot, id), { id, platform, kind: 'run', status, startedAt });
    return id;
  };
  const keptFail = await seed(2 * day, 'web', 'failed');
  const oldFail = await seed(90 * day, 'web', 'failed');
  const stuck = await seed(120 * day, 'web', 'running');
  const passes: string[] = [];
  for (let i = 1; i <= 5; i++) passes.push(await seed(i * 1000, 'web', 'passed'));

  const dropped = await prune(runsRoot, { keepFailedDays: 30, keepPassedPerPlatform: 3 });
  const left = new Set((await listRuns(runsRoot)).map((r) => r.id));

  assert(left.has(keptFail), 'a recent failure is kept — it is the evidence you came for');
  assert(!left.has(oldFail), 'a failure past the window is dropped');
  assert(left.has(stuck), 'a run still marked running is never pruned');
  // passes[] is oldest-last because each seed is 1s newer than the previous.
  assert(passes.slice(0, 3).every((id) => left.has(id)), 'the newest 3 passes survive');
  assert(passes.slice(3).every((id) => !left.has(id)), 'older passes beyond the baseline go');
  assert(dropped.length === 3, 'prune reports exactly what it deleted');
  assert(
    runDirName('2026-08-07T18:45:46.547Z', 'android', '@login') ===
      '2026-08-07T18-45-46Z-android-login',
    'run directory names sort chronologically and carry platform and tag',
  );

  console.log('\nAll smoke checks passed.');
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
