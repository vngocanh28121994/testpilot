import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { remote } from 'webdriverio';
import type { Observed } from '../crawl/observe.js';
import type { LocatorCandidate, Platform } from '../core/types.js';
import type { UiDriver, UiHandle } from './driver.js';

type WdioBrowser = Awaited<ReturnType<typeof remote>>;
type WdioElement = Awaited<ReturnType<WdioBrowser['$']>>;

export interface NativeDriverOptions {
  platform: 'android' | 'ios';
  /** Omitted when running inside AWS Device Farm — the host injects the endpoint. */
  hostname?: string;
  port?: number;
  path?: string;
  /** Sent to Appium as `appium:deviceName`. A capability, not a label. */
  deviceName: string;
  /**
   * What to call this device in reports and in the flake history.
   *
   * Separate from `deviceName` because that one is a capability the Appium
   * server acts on. Feeding the real handset name into it — to get better
   * labels — changes what is asked of the server, which is not what was
   * intended and not something a reporting change should ever do.
   */
  reportedDevice?: string;
  /** `app` is ignored on Device Farm; the farm installs the package itself. */
  app?: string;
  appPackage?: string;
  appActivity?: string;
  bundleId?: string;
  artifactsDir: string;
  /**
   * Capacitor / Cordova / Ionic app: the UI is a web page inside a WebView, so
   * every element lives in the DOM and none of it is reachable through native
   * locators. With this on, the driver switches into the WebView context after
   * launch and translates locators to CSS/XPath instead of UiSelector.
   */
  hybrid?: boolean;
  /** WebViews attach a second or two after the activity does. */
  webviewTimeoutMs?: number;
  /**
   * Force-stop the app before each scenario so none of them inherits the last
   * one's screen state. Android only — see `android.isolation` in config.ts.
   */
  isolation?: 'restart' | 'none';
}

class NativeHandle implements UiHandle {
  constructor(
    readonly candidate: LocatorCandidate,
    readonly el: WdioElement,
  ) {}

  async isVisible(): Promise<boolean> {
    return this.el.isDisplayed();
  }

  async text(): Promise<string> {
    return (await this.el.getText()).trim();
  }

  /**
   * On Android an EditText reports its contents through the same `text`
   * attribute as any other node, so this is `text()` without the trim — leading
   * or trailing whitespace in a field is exactly the kind of thing worth
   * catching, not tidying away.
   */
  async value(): Promise<string | null> {
    return this.el.getText().catch(() => null);
  }
}

export class NativeUiDriver implements UiDriver {
  readonly platform: Platform;
  readonly device: string;

  private browser?: WdioBrowser;
  /** Last view-hierarchy digest, used by isIdle() to detect a settled screen. */
  private lastDigest = '';
  /** Name of the WebView context we are driving, once one has been found. */
  private webview?: string;
  /**
   * Which foregrounding command this Appium build accepts: undefined = not yet
   * probed, null = probed and none of them exist. Scoped to the session, since
   * that is the lifetime over which the answer is fixed.
   */
  private activateVia?: [string, Record<string, unknown>] | null;
  /** false once the server has refused `mobile: shell`; see restartApp(). */
  private canShell = true;

  constructor(private readonly opts: NativeDriverOptions) {
    this.platform = opts.platform;
    this.device = opts.reportedDevice ?? opts.deviceName;
  }

  private get b(): WdioBrowser {
    if (!this.browser) throw new Error('NativeUiDriver.start() was not called.');
    return this.browser;
  }

  async start(): Promise<void> {
    await mkdir(this.opts.artifactsDir, { recursive: true });
    const isAndroid = this.opts.platform === 'android';
    this.browser = await remote({
      hostname: this.opts.hostname ?? '127.0.0.1',
      port: this.opts.port ?? 4723,
      path: this.opts.path ?? '/',
      logLevel: 'warn',
      capabilities: {
        platformName: isAndroid ? 'Android' : 'iOS',
        'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
        'appium:deviceName': this.opts.deviceName,
        ...(this.opts.app ? { 'appium:app': this.opts.app } : {}),
        ...(this.opts.appPackage ? { 'appium:appPackage': this.opts.appPackage } : {}),
        ...(this.opts.appActivity ? { 'appium:appActivity': this.opts.appActivity } : {}),
        ...(this.opts.bundleId ? { 'appium:bundleId': this.opts.bundleId } : {}),
        // No implicit wait on purpose: the resolver owns all waiting.
        'appium:newCommandTimeout': 300,
        // Grant runtime permissions at install. Without this the very first
        // scenario races an OS dialog — TCInvest's notification prompt sat on
        // top of the login screen and every locator missed for a reason that
        // had nothing to do with the app under test.
        ...(isAndroid ? { 'appium:autoGrantPermissions': true } : {}),
        // A device's WebView updates faster than chromedriver releases, so an
        // exact-version match is often impossible. Order of preference: a driver
        // shipped inside the test package (the only thing that works when the
        // host has no outbound internet, which is the case on Device Farm),
        // then Appium's own download, then using whatever it has anyway.
        ...(this.opts.hybrid && isAndroid
          ? {
              ...(process.env.TESTPILOT_CHROMEDRIVER
                ? { 'appium:chromedriverExecutable': process.env.TESTPILOT_CHROMEDRIVER }
                : { 'appium:chromedriverAutodownload': true }),
              'appium:chromedriverDisableBuildCheck': true,
              'appium:showChromedriverLog': true,
              // This app's WebView exposes `@webview_devtools_remote_<pid>`.
              // With details collection on, Appium renames the context to
              // WEBVIEW_<package> and then hands chromedriver
              // `androidProcess: <package>` — so chromedriver looks for
              // `webview_devtools_remote_<package>`, which does not exist, and
              // polls a dead forwarded port until it times out. Leaving the
              // context pid-named keeps the socket name chromedriver derives
              // aligned with the one the device actually published.
              'appium:enableWebviewDetailsCollection': false,
            }
          : {}),
      },
    });

    if (this.opts.hybrid) await this.enterWebview();
  }

  async stop(): Promise<void> {
    await this.browser?.deleteSession();
    // Everything discovered about the server belongs to the session that is
    // now gone; a reused driver object must probe the next one from scratch.
    this.browser = undefined;
    this.webview = undefined;
    this.activateVia = undefined;
    this.canShell = true;
  }

  async launch(_target?: string): Promise<void> {
    const id = this.opts.bundleId ?? this.opts.appPackage;
    if (id) {
      if (this.opts.isolation === 'restart' && this.opts.platform === 'android') {
        await this.restartApp(id);
      }
      // Brings the app back to the foreground — after a force-stop this is what
      // starts it again, and without one it is the whole of `I open the app`.
      await this.activateApp(id);
    }
    // Re-entering the app tears the old WebView down, so the handle is stale.
    this.webview = undefined;
    if (this.opts.hybrid) await this.enterWebview();
  }

  /**
   * Kills the app's process so the next scenario starts from a rebuilt UI.
   *
   * Re-launching an activity that is already running only brings it forward:
   * the process, and with it a WebView's entire DOM, survives untouched. That
   * is how a password typed in scenario 2 was still sitting in the field in
   * scenario 6, and why the same login passed alone and failed in a suite.
   *
   * `am force-stop` and not `mobile: clearApp`, which is the heavier option:
   * clearApp also wipes storage and the permissions granted at install time, so
   * the OS permission dialog comes back and lands on top of the screen under
   * test. Killing the process rebuilds the UI and keeps everything else.
   *
   * Needs Appium started with `--allow-insecure=adb_shell`. Where that is
   * missing the server refuses once, and the run continues without isolation
   * rather than failing — a suite that still runs is worth more than a suite
   * that is right about why it cannot.
   */
  private async restartApp(id: string): Promise<void> {
    if (!this.canShell) return;
    try {
      await this.b.execute('mobile: shell', { command: 'am', args: ['force-stop', id] });
    } catch (err) {
      this.canShell = false;
      console.warn(
        `[native] không force-stop được app, các scenario sẽ dùng chung trạng thái: ` +
          `${firstLine((err as Error).message)}\n  ` +
          `Khởi động Appium với --allow-insecure=adb_shell để bật lại.`,
      );
    }
  }

  /**
   * Brings the app to the foreground, tolerating which `mobile:` commands the
   * server happens to expose.
   *
   * `mobile: activateApp` is the obvious call and is missing from the Appium
   * build AWS Device Farm ships, which rejects it outright and takes the whole
   * run with it. The command set genuinely differs between Appium versions, so
   * this tries the alternatives rather than assuming one.
   *
   * The answer is then remembered for the rest of the session. `launch()` runs
   * once per scenario, and on Device Farm the full probe costs ~1.5s of billed
   * device time to arrive at the same "none of these exist" it arrived at last
   * scenario — a suite of five scenarios paid that four times over for nothing.
   * A server cannot gain or lose commands mid-session, so one probe is enough.
   *
   * Failing to re-foreground is a warning, not an error: the session already
   * launched the app, so the usual state is that it is in the foreground
   * already and there was nothing to do.
   */
  private async activateApp(id: string): Promise<void> {
    // null means "probed, and this server supports none of them".
    if (this.activateVia === null) return;
    if (this.activateVia) {
      try {
        await this.b.execute(this.activateVia[0], this.activateVia[1]);
        return;
      } catch {
        // The command existed a moment ago and now does not work. Fall through
        // and probe again rather than trusting a cache that just lied.
        this.activateVia = undefined;
      }
    }

    const attempts: Array<[string, Record<string, unknown>]> = [
      ['mobile: activateApp', { appId: id, bundleId: id }],
      ...(this.opts.platform === 'android' && this.opts.appActivity
        ? ([
            ['mobile: startActivity', { intent: `${id}/${this.opts.appActivity}` }],
            ['mobile: startActivity', { appPackage: id, appActivity: this.opts.appActivity }],
          ] as Array<[string, Record<string, unknown>]>)
        : []),
    ];

    const failures: string[] = [];
    for (const [command, args] of attempts) {
      try {
        await this.b.execute(command, args);
        this.activateVia = [command, args];
        return;
      } catch (err) {
        failures.push(`${command}: ${firstLine((err as Error).message)}`);
      }
    }
    this.activateVia = null;
    console.warn(
      `[native] không đưa được app lên foreground; tiếp tục vì phiên đã mở sẵn app.\n  ` +
        `(đã ghi nhớ, các scenario sau sẽ bỏ qua bước này)\n  ` +
        failures.join('\n  '),
    );
  }

  /* ---------------------------------------------------------------- */
  /* WebView contexts                                                  */
  /* ---------------------------------------------------------------- */

  /** WDIO returns either plain names or context objects depending on the driver. */
  private async contextNames(): Promise<string[]> {
    const raw = (await this.b.getContexts()) as Array<string | { id?: string }>;
    return raw.map((c) => (typeof c === 'string' ? c : (c.id ?? ''))).filter(Boolean);
  }

  /**
   * Polls until a WebView context shows up, then switches into it.
   *
   * The failure here is worth a long message: by far the most common cause is
   * not a timing problem but a build setting. Appium can only attach to a
   * WebView the app has explicitly made inspectable, and release builds
   * normally have not.
   */
  private async enterWebview(): Promise<void> {
    const deadline = Date.now() + (this.opts.webviewTimeoutMs ?? 30_000);
    let seen: string[] = [];

    for (;;) {
      seen = await this.contextNames();
      const found = pickWebviewContext(seen);
      if (found) {
        await this.b.switchContext(found);
        this.webview = found;
        return;
      }
      if (Date.now() > deadline) break;
      await sleep(500);
    }

    throw new Error(
      `Không tìm thấy WebView context sau ${Math.round((this.opts.webviewTimeoutMs ?? 30_000) / 1000)}s. ` +
        `Context hiện có: ${seen.join(', ') || '(không có)'}.\n` +
        'Nguyên nhân hay gặp nhất không phải do chờ chưa đủ mà do bản build: ' +
        'Appium chỉ nhìn thấy WebView nếu app bật WebView.setWebContentsDebuggingEnabled(true) ' +
        '(Android) hoặc WKWebView.isInspectable = true (iOS 16.4+). Bản release thường tắt. ' +
        'Xin team app một bản debuggable, hoặc tắt cờ hybrid để chạy bằng locator native.',
    );
  }

  /** True when locators must be resolved against the DOM rather than the view tree. */
  private get inWebview(): boolean {
    return this.webview !== undefined;
  }

  /**
   * Runs a native-only command (the `mobile:` gestures all are) with the
   * context flipped back, then restores the WebView. Element ids do not carry
   * across contexts, so anything inside `fn` must work without one.
   */
  private async asNative<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.inWebview) return fn();
    await this.b.switchContext('NATIVE_APP');
    try {
      return await fn();
    } finally {
      try {
        await this.b.switchContext(this.webview!);
      } catch {
        // Chrome renumbers contexts when tabs come and go; re-resolve rather
        // than leaving the driver stuck in NATIVE_APP.
        this.webview = undefined;
        await this.enterWebview();
      }
    }
  }

  async find(c: LocatorCandidate): Promise<UiHandle | null> {
    const selector = this.toSelector(c);
    try {
      const el = await this.b.$(selector);
      if (!(await el.isExisting())) return null;
      return new NativeHandle(c, el);
    } catch (err) {
      // A WebView that navigated or reloaded invalidates the context, and every
      // lookup then fails with "no such window" until it is re-acquired. The
      // resolver polls, so recovering here turns a fatal error into one slow tick.
      if (this.inWebview && isContextLost(err)) {
        this.webview = undefined;
        await this.enterWebview();
        return null;
      }
      throw err;
    }
  }

  private toSelector(c: LocatorCandidate): string {
    if (this.inWebview) return this.toDomSelector(c);
    const android = this.opts.platform === 'android';
    switch (c.strategy) {
      case 'testId':
        // `~` is the accessibility id: Android content-desc, iOS accessibilityIdentifier.
        return `~${c.value}`;
      case 'label':
        // Exact text, not "contains" — and that is not a style preference.
        // Inside a WebView the container node carries the concatenated text of
        // the entire page, so `textContains` matches that container before it
        // matches the widget. Appium returns it, and tapping it hits the centre
        // of the whole screen: a button press lands wherever the middle of the
        // page happens to be. Exact match cannot hit the container, whose text
        // is the entire page. Use the `predicate` strategy when a substring is
        // genuinely wanted. drivers/web.ts guards the same trap with `not(*)`.
        return android
          ? `android=new UiSelector().text("${esc(c.value)}")`
          : `-ios predicate string:label == "${esc(c.value)}" OR name == "${esc(c.value)}"`;
      case 'role':
        // Role maps to the native widget class; the optional name narrows it down.
        return android
          ? `android=new UiSelector().className("${esc(c.value)}")` +
              (c.name ? `.textContains("${esc(c.name)}")` : '')
          : `-ios predicate string:type == "${esc(c.value)}"` +
              (c.name ? ` AND label CONTAINS "${esc(c.name)}"` : '');
      case 'placeholder':
        return android
          ? `android=new UiSelector().descriptionContains("${esc(c.value)}")`
          : `-ios predicate string:value CONTAINS "${esc(c.value)}"`;
      case 'predicate':
        return android ? `android=${c.value}` : `-ios predicate string:${c.value}`;
      case 'xpath':
        return c.value.startsWith('//') ? c.value : `//${c.value}`;
      case 'css':
        throw new Error('The "css" strategy is web-only and has no native equivalent.');
    }
  }

  private toDomSelector(c: LocatorCandidate): string {
    return domSelector(c);
  }

  async tap(h: UiHandle): Promise<void> {
    await (h as NativeHandle).el.click();
  }

  async longPress(h: UiHandle, ms: number): Promise<void> {
    const el = (h as NativeHandle).el;
    if (this.inWebview) {
      // `mobile: longClickGesture` takes a native element id, which a DOM
      // element does not have. W3C pointer actions work through chromedriver.
      await this.b
        .action('pointer')
        .move({ origin: el })
        .down()
        .pause(ms)
        .up()
        .perform();
      return;
    }
    await this.b.execute('mobile: longClickGesture', { elementId: el.elementId, duration: ms });
  }

  async input(h: UiHandle, text: string): Promise<void> {
    const el = (h as NativeHandle).el;
    await el.clearValue();
    await el.setValue(text);
  }

  async clear(h: UiHandle): Promise<void> {
    await (h as NativeHandle).el.clearValue();
  }

  async selectOption(h: UiHandle, option: string): Promise<void> {
    // Native pickers have no <select>: open the control, then tap the option by label.
    await (h as NativeHandle).el.click();
    const opt = await this.find({ strategy: 'label', value: option, weight: 1, origin: 'authored' });
    if (!opt) throw new Error(`Option "${option}" did not appear after opening the picker.`);
    await this.tap(opt);
  }

  async scrollIntoView(h: UiHandle): Promise<void> {
    const el = (h as NativeHandle).el;
    if (this.inWebview) {
      await this.b.execute(
        'arguments[0].scrollIntoView({block: "center", behavior: "instant"})',
        el,
      );
      return;
    }
    if (this.opts.platform === 'android') {
      await this.b.execute('mobile: scrollGesture', {
        elementId: el.elementId,
        direction: 'down',
        percent: 1.0,
      });
    } else {
      await this.b.execute('mobile: scroll', { elementId: el.elementId, toVisible: true });
    }
  }

  async swipe(direction: 'left' | 'right' | 'up' | 'down'): Promise<void> {
    if (this.inWebview && (direction === 'up' || direction === 'down')) {
      // Vertical swipes in a hybrid app almost always mean "scroll the page".
      // Doing it in JS is both faster and more reliable than a native fling,
      // which the WebView may swallow or turn into a pull-to-refresh.
      await this.b.execute(
        'window.scrollBy({top: arguments[0] * window.innerHeight * 0.8, behavior: "instant"})',
        direction === 'down' ? 1 : -1,
      );
      return;
    }

    await this.asNative(async () => {
      const { width, height } = await this.b.getWindowSize();
      await this.b.execute('mobile: swipeGesture', {
        left: Math.round(width * 0.1),
        top: Math.round(height * 0.2),
        width: Math.round(width * 0.8),
        height: Math.round(height * 0.6),
        direction,
        percent: 0.75,
      });
    });
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.swipe(direction);
  }

  async back(): Promise<void> {
    if (this.opts.platform === 'android') {
      // The hardware back key, not history.back(): that is what a user presses,
      // and Capacitor apps hook it to drive their own router.
      await this.asNative(() => this.b.back());
    } else {
      await this.swipe('right'); // iOS edge-swipe back
    }
  }

  async screenshot(name: string): Promise<string> {
    const file = path.join(this.opts.artifactsDir, `${name.replace(/[^a-z0-9-_]+/gi, '_')}.png`);
    // Taken from the native context on purpose: chromedriver would capture only
    // the web viewport, and a failure shot that omits a native permission
    // dialog on top of it is exactly the shot that fails to explain anything.
    const shot = await this.asNative(() => this.b.takeScreenshot());
    await writeFile(file, Buffer.from(shot, 'base64'));
    return file;
  }

  /**
   * Captures the tree the scenario is starting from.
   *
   * The failure dump answers "what was on screen when it broke", which is not
   * the same question as "what was on screen when we began" — and when a step
   * passes but has no effect, only the second one tells you whether the element
   * you typed into was the one you meant.
   */
  async beginScenario(scenarioId: string): Promise<void> {
    await this.dumpTree(`${scenarioId}-start`).catch(() => undefined);
  }

  /**
   * The UiAutomator2 XML tree, or the DOM when driving a WebView. This is the
   * one artifact that answers "why did that locator miss" without another run.
   */
  async dumpTree(name: string): Promise<string | undefined> {
    try {
      const xml = await this.asNative(() => this.b.getPageSource());
      const file = path.join(
        this.opts.artifactsDir,
        `${name.replace(/[^a-z0-9-_]+/gi, '_')}.tree.xml`,
      );
      await writeFile(file, xml, 'utf8');
      return file;
    } catch {
      // Diagnostics must never turn a reported failure into a crash.
      return undefined;
    }
  }

  /**
   * Exposes the raw UiAutomator2 / XCUITest XML page source.
   *
   * Used by NativeObservationAdapter.createNativeObservationProvider() for
   * richer observation (bounds, enabled, parent/child hierarchy) than the
   * existing observe() method provides.
   */
  async getPageSource(): Promise<string> {
    return this.asNative(() => this.b.getPageSource());
  }

  /**
   * Harvests the accessibility tree into observations.
   *
   * Parsed from the XML page source rather than by querying element by element:
   * a UiAutomator2 lookup is a network round trip, and a screen has hundreds of
   * nodes. `container` is recorded per node because a WebView's wrapper carries
   * the concatenated text of everything inside it, and ranking has to know that
   * before it offers a text locator.
   */
  async observe(): Promise<Observed[]> {
    const xml = await this.getPageSource();
    return parseUiAutomatorXml(xml);
  }

  /**
   * Native has no `networkidle`, so "idle" means the view hierarchy stopped
   * changing between two consecutive samples. Cheap, and it catches the common
   * case of asserting into a running transition.
   */
  async isIdle(): Promise<boolean> {
    const digest = createHash('sha1').update(await this.b.getPageSource()).digest('hex');
    const stable = digest === this.lastDigest;
    this.lastDigest = digest;
    return stable;
  }
}

/**
 * Locator translation inside a WebView. Exported so it can be tested without a
 * device — this mapping is the part most likely to be subtly wrong.
 *
 * It deliberately mirrors what drivers/web.ts asks Playwright for, because one
 * element registry drives both: a testId that resolves under Playwright has to
 * resolve here too, or the intent layer stops being one layer.
 */
export function domSelector(c: LocatorCandidate): string {
  switch (c.strategy) {
      case 'testId': {
        // Playwright's getByTestId reads data-testid. Accept the other two
        // spellings teams actually use rather than failing on a naming choice.
        const v = cssEscape(c.value);
        return `[data-testid="${v}"],[data-test="${v}"],[data-cy="${v}"]`;
      }

      case 'placeholder':
        return `[placeholder="${cssEscape(c.value)}"]`;

      case 'role': {
        // Match the explicit ARIA role or the tag that implies it, the way
        // getByRole does; `name` narrows by accessible name or visible text.
        const tags = IMPLICIT_ROLE_TAGS[c.value] ?? [];
        const self = ['@role=' + xpathLiteral(c.value), ...tags.map((t) => `self::${t}`)].join(' or ');
        const named = c.name
          ? `[${accessibleNameMatches(c.name)}]`
          : '';
        return `//*[${self}]${named}`;
      }

      case 'label': {
        // Accessible label first, then visible text — same order as web.ts.
        // The text arm is restricted to leaf nodes: without it every ancestor
        // up to <body> "contains" the string and the match is useless.
        const lit = xpathLiteral(c.value);
        return [
          `//*[@aria-label=${lit}]`,
          `//label[normalize-space()=${lit}]//input`,
          `//label[normalize-space()=${lit}]//textarea`,
          `//*[@id=//label[normalize-space()=${lit}]/@for]`,
          `//*[not(*) and contains(normalize-space(.), ${lit})]`,
        ].join(' | ');
      }

      case 'css':
        return c.value;

      case 'xpath':
        return c.value.startsWith('/') ? c.value : `//${c.value}`;

      case 'predicate':
        throw new Error(
          'Chiến lược "predicate" là của native iOS, không dùng được trong WebView. ' +
            'Dùng css hoặc xpath cho app hybrid.',
        );
    }
}

function esc(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Picks the WebView context to drive out of everything Appium reports.
 *
 * Exported so it can be tested without a device. It has to accept both naming
 * schemes: Appium normally renames the context to `WEBVIEW_<package>`, but with
 * `enableWebviewDetailsCollection` off — which this driver sets, because that
 * rename breaks the devtools socket name chromedriver derives — it stays
 * `WEBVIEW_<pid>`.
 */
export function pickWebviewContext(contexts: string[]): string | undefined {
  return contexts.find((c) => c !== 'NATIVE_APP' && /WEBVIEW|CHROMIUM/i.test(c));
}

function isContextLost(err: unknown): boolean {
  const m = String((err as Error)?.message ?? '').toLowerCase();
  return (
    m.includes('no such window') ||
    m.includes('target window already closed') ||
    m.includes('web view not found') ||
    m.includes('chrome not reachable')
  );
}

/** Tags that carry an implicit ARIA role, so getByRole-style lookups match them. */
const IMPLICIT_ROLE_TAGS: Record<string, string[]> = {
  button: ['button', "input[@type='button']", "input[@type='submit']"],
  link: ['a'],
  textbox: ['input', 'textarea'],
  checkbox: ["input[@type='checkbox']"],
  radio: ["input[@type='radio']"],
  heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  img: ['img'],
  list: ['ul', 'ol'],
  listitem: ['li'],
  combobox: ['select'],
};

/** Accessible name, the way a screen reader would compute the common cases. */
function accessibleNameMatches(name: string): string {
  const lit = xpathLiteral(name);
  return [
    `@aria-label=${lit}`,
    `@title=${lit}`,
    `@value=${lit}`,
    `contains(normalize-space(.), ${lit})`,
  ].join(' or ');
}

/**
 * XPath 1.0 has no escape character, so a literal containing both quote kinds
 * can only be written as a concat(). Values come from generated locators and
 * from product copy, so apostrophes are routine.
 */
function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  const parts = s.split("'").map((p) => `'${p}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

/** Escapes a value for use inside a CSS attribute-selector string. */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** Appium errors list every supported command; only the first line is useful. */
function firstLine(message: string): string {
  return message.split('\n')[0]!.slice(0, 120);
}

/**
 * Reads a UiAutomator2 page source into observations.
 *
 * A hand-rolled scan rather than an XML parser: the format is a flat stream of
 * self-describing `<node .../>` tags, and adding a parser dependency to read it
 * would be the larger cost. Attribute values are XML-escaped, so they are
 * unescaped here rather than at every use site.
 */
export function parseUiAutomatorXml(xml: string): Observed[] {
  const out: Observed[] = [];
  const byClass = new Map<string, number>();

  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>/g)) {
    const attrs = m[1] ?? '';
    const selfClosing = m[2] === '/';
    const get = (key: string): string | undefined => {
      const a = new RegExp(`\\b${key}="([^"]*)"`).exec(attrs);
      const v = a?.[1] ? unescapeXml(a[1]) : '';
      return v.trim() ? v.trim() : undefined;
    };

    const cls = get('class');
    if (!cls) continue;

    const n = byClass.get(cls) ?? 0;
    byClass.set(cls, n + 1);

    // A self-closing <node/> has no children; an open tag wraps others.
    const resource = get('resource-id');
    out.push({
      ...(resource ? { resourceId: resource.split('/').pop() ?? resource } : {}),
      role: cls,
      ...(get('content-desc') ? { name: get('content-desc')! } : {}),
      ...(get('text') ? { text: get('text')! } : {}),
      interactive: get('clickable') === 'true' || /Edit|Button|CheckBox|Switch/.test(cls),
      index: n,
      container: !selfClosing,
    });
  }
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
