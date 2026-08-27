import { exec as execCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { labelXPaths } from '../core/labelXPath.js';
import { promisify } from 'node:util';
import { remote } from 'webdriverio';
import type { Observed } from '../crawl/observe.js';
import type { LocatorCandidate, Platform } from '../core/types.js';
import { relativeRowLocatorXPath } from '../core/contextual.js';
import type { ControlInspection, UiDriver, UiHandle, UiMatchSnapshot } from './driver.js';
import { WebViewCdpDriver, WebViewCdpHandle, isCdpSessionLost } from './WebViewCdpDriver.js';
import type { PopupRule } from './PopupInterceptor.js';
import { checkAppVersion } from './appVersion.js';

const execAsync = promisify(execCb);

/**
 * Buttons worth pressing on a system dialog, best answer first.
 *
 * Granting is preferred over denying: a denied notification permission is asked
 * for again on the next launch, so denying it makes the dialog a recurring
 * obstacle instead of a one-time one.
 *
 * Nothing here matches Samsung's "Dùng mã PIN" — see clearBlockingDialogs.
 */
const NATIVE_DIALOG_BUTTONS = [
  'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_button")',
  'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_foreground_only_button")',
  'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_deny_button")',
  'android=new UiSelector().resourceId("android:id/button1")',
  'android=new UiSelector().resourceId("android:id/button2")',
  'android=new UiSelector().text("Cho phép")',
  'android=new UiSelector().text("Không cho phép")',
  'android=new UiSelector().text("Allow")',
  'android=new UiSelector().text("Deny")',
  'android=new UiSelector().text("OK")',
  'android=new UiSelector().text("ALLOW")',
  'android=new UiSelector().text("DENY")',
];

/**
 * Alert buttons worth pressing on iOS, best answer first.
 *
 * Same reasoning as the Android list: granting beats denying, because a denied
 * permission is asked for again on the next launch and becomes a recurring
 * obstacle. Anything offering to open Settings, buy something or update the app
 * is deliberately absent — those navigate away from the app under test.
 */
const IOS_ALERT_BUTTONS = [
  'Cho phép', 'Allow', 'Allow While Using App', 'OK', 'Đồng ý',
  'Không cho phép', "Don't Allow", 'Từ chối',
  'Để sau', 'Not Now', 'Bỏ qua', 'Skip', 'Cancel', 'Huỷ', 'Hủy', 'Đóng', 'Close',
];

/**
 * Names the kind of system window covering the app, or undefined when the app
 * itself has focus.
 *
 * Matched on the focused window and activity rather than by hunting for
 * buttons: a text scan finds "OK" inside the app's own UI just as readily as in
 * a dialog, and pressing that is a silent, undebuggable detour mid-scenario.
 */
function blockingKind(focus: string, appPackage?: string): string | undefined {
  if (!focus) return undefined;
  if (appPackage && focus.includes(appPackage) && !/permissioncontroller|Biometric/i.test(focus)) {
    return undefined;
  }
  if (/permissioncontroller/i.test(focus)) return 'permission';
  if (/BiometricPrompt|biometrics|ConfirmDeviceCredential/i.test(focus)) return 'biometric';
  if (/NotificationShade/i.test(focus)) return 'notification shade';
  if (/VolumeDialog|StatusBar/i.test(focus)) return 'system ui';
  return undefined;
}

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
   * Which handset to attach to when more than one is available.
   *
   * `deviceName` cannot answer that: Appium treats it as a loose match and
   * picks whatever it finds first, so three plugged-in phones are three ways to
   * drive the wrong one. On Android this is also the adb serial — see
   * `deviceSerial`, which callers set from the same value.
   */
  udid?: string;
  /**
   * Port UiAutomator2 listens on for this session (Android).
   *
   * Unique per concurrent session or two sessions collide on the default and
   * one of them dies. Unset for a lone run, which is why it stays optional.
   */
  systemPort?: number;
  /** The same idea for iOS: the port this session's WebDriverAgent binds. */
  wdaLocalPort?: number;
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
  /**
   * Reinstall `app` even when a package with the same id and version is already
   * on the device. Needed because this app's environments are indistinguishable
   * to Appium — see core/deviceEnv.ts.
   */
  enforceAppInstall?: boolean;
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
  /** Serial number for adb commands targeting a specific device/emulator. */
  deviceSerial?: string;
  /** iOS real-device signing; see the Ios section of the config schema. */
  teamId?: string;
  signingId?: string;
  wdaBundleId?: string;
  /** App-specific DOM popup rules shared with the browser driver. */
  popupRules?: PopupRule[];
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

  async selected(): Promise<boolean | undefined> {
    const selected = await this.el.getAttribute('selected').catch(() => null);
    if (selected === 'true') return true;
    if (selected === 'false') return false;
    const checked = await this.el.getAttribute('checked').catch(() => null);
    if (checked === 'true') return true;
    if (checked === 'false') return false;
    return undefined;
  }
}

export class NativeUiDriver implements UiDriver {
  readonly device: string;

  /** Keep report/flakiness identity stable while `platform` follows context. */
  get runPlatform(): Platform {
    return this.opts.platform;
  }

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
  /** Playwright/CDP delegate for WebView operations — set when hybrid=true on Android. */
  private cdpDriver?: WebViewCdpDriver;
  /** Timestamp of last dismissOverlay() call — throttles context switching. */
  private lastOverlayCheck = 0;
  /** True once launch() has tried to reach a WebView through Appium and failed. */
  private webviewUnavailable = false;

  /** Exposed as 'web' when we are inside a WebView so the resolver picks CSS/label
   *  candidates instead of UiSelector predicates that are meaningless in that context. */
  get platform(): Platform {
    return this.inWebview || this.cdpConnected ? 'web' : this.opts.platform;
  }

  constructor(private readonly opts: NativeDriverOptions) {
    this.device = opts.reportedDevice ?? opts.deviceName;
  }

  private get b(): WdioBrowser {
    if (!this.browser) throw new Error('NativeUiDriver.start() was not called.');
    return this.browser;
  }

  async start(): Promise<void> {
    await mkdir(this.opts.artifactsDir, { recursive: true });
    const isAndroid = this.opts.platform === 'android';
    // Must run before the session launches the app: granting a permission does
    // not dismiss a dialog that is already on screen.
    if (isAndroid) {
      await this.warnOnAppVersionSkew();
      await this.grantPendingPermissions();
      await this.clearBlockingDialogs();
      await this.killWebViewApps();
    }
    try {
    this.browser = await remote({
      hostname: this.opts.hostname ?? '127.0.0.1',
      port: this.opts.port ?? 4723,
      path: this.opts.path ?? '/',
      logLevel: 'error',
      // The first iOS session on a machine compiles WebDriverAgent from source
      // and installs it — minutes, not seconds. WebdriverIO's default request
      // timeout aborts the POST /session long before that finishes, and Appium
      // then kills the build it had started: "** BUILD INTERRUPTED **". Android
      // keeps the default; it has nothing to compile.
      ...(isAndroid ? {} : { connectionRetryTimeout: 15 * 60_000 }),
      capabilities: {
        platformName: isAndroid ? 'Android' : 'iOS',
        'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
        'appium:deviceName': this.opts.deviceName,
        // Only sent when configured. A single-device run has never supplied any
        // of these, and adding them unasked would change which handset Appium
        // picks and which ports it binds.
        ...(this.opts.udid ? { 'appium:udid': this.opts.udid } : {}),
        ...(isAndroid && this.opts.systemPort
          ? { 'appium:systemPort': this.opts.systemPort }
          : {}),
        ...(!isAndroid && this.opts.wdaLocalPort
          ? { 'appium:wdaLocalPort': this.opts.wdaLocalPort }
          : {}),
        ...(this.opts.app ? { 'appium:app': this.opts.app } : {}),
        ...(this.opts.app && this.opts.enforceAppInstall
          ? { 'appium:enforceAppInstall': true }
          : {}),
        ...(this.opts.appPackage ? { 'appium:appPackage': this.opts.appPackage } : {}),
        ...(this.opts.appActivity ? { 'appium:appActivity': this.opts.appActivity } : {}),
        ...(this.opts.bundleId ? { 'appium:bundleId': this.opts.bundleId } : {}),
        // No implicit wait on purpose: the resolver owns all waiting.
        'appium:newCommandTimeout': 300,
        // /proc/net/unix can be slow on some devices when listing WebView sockets.
        ...(isAndroid ? { 'appium:adbExecTimeout': 60000 } : {}),
        // Grant runtime permissions at install. Without this the very first
        // scenario races an OS dialog — TCInvest's notification prompt sat on
        // top of the login screen and every locator missed for a reason that
        // had nothing to do with the app under test.
        ...(isAndroid ? { 'appium:autoGrantPermissions': true } : {}),
        // iOS only, and on by default while iOS has never completed a run here.
        // Without it Appium reports "xcodebuild failed with code 65" and throws
        // the compiler's own output away — which is the only place that says
        // whether it was signing, a provisioning profile or an SDK mismatch.
        ...(isAndroid ? {} : { 'appium:showXcodeLog': true }),
        // Appium's own patience with WDA, separate from the request timeout
        // above. Its 60s default is shorter than a first-time build, so it
        // aborted a build that was progressing normally.
        ...(isAndroid ? {} : { 'appium:wdaLaunchTimeout': 10 * 60_000 }),
        // Handed to the WebDriverAgent build. Sent only when configured, so a
        // simulator run — which needs no signature — is unaffected.
        ...(!isAndroid && this.opts.teamId
          ? {
              'appium:xcodeOrgId': this.opts.teamId,
              'appium:xcodeSigningId': this.opts.signingId ?? 'Apple Development',
              ...(this.opts.wdaBundleId
                ? { 'appium:updatedWDABundleId': this.opts.wdaBundleId }
                : {}),
              // Lets Xcode create the provisioning profile — and register the
              // handset with the team — instead of demanding one that exists.
              // A fresh WDA bundle id has no profile by definition, so without
              // this the very first run cannot succeed: "No profiles for
              // '<id>.xctrunner' were found. Automatic signing is disabled."
              // The driver turns this single flag into both
              // -allowProvisioningUpdates and -allowProvisioningDeviceRegistration.
              'appium:allowProvisioningDeviceRegistration': true,
            }
          : {}),
        // Keep the app process alive between scenarios so each scenario starts warm
        // (FLAG_ACTIVITY_REORDER_TO_FRONT) rather than cold-starting and re-triggering
        // any first-launch flows. Requires a debuggable build so Appium can see the
        // WebView context (WebView.setWebContentsDebuggingEnabled(true)).
        ...(isAndroid && this.opts.isolation === 'restart'
          ? {
              'appium:dontStopAppOnReset': true,
              'appium:noReset': true,
            }
          : {}),
        // A device's WebView updates faster than chromedriver releases, so an
        // exact-version match is often impossible. Order of preference: a driver
        // shipped inside the test package (the only thing that works when the
        // host has no outbound internet, which is the case on Device Farm),
        // then Appium's own download, then using whatever it has anyway.
        ...(this.opts.hybrid && isAndroid
          ? {
              ...(process.env.TESTPILOT_CHROMEDRIVER
                ? { 'appium:chromedriverExecutable': process.env.TESTPILOT_CHROMEDRIVER }
                : {
                    'appium:chromedriverExecutable': `${process.env.HOME}/.appium/chromedriver/chromedriver150`,
                    'appium:chromedriverAutodownload': true,
                  }),
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
    } catch (err: unknown) {
      const msg = errorMessageChain(err);
      if (/ECONNREFUSED|UND_ERR_SOCKET|network error|fetch failed|socket hang up|ECONNRESET/i.test(msg)) {
        const host = this.opts.hostname ?? '127.0.0.1';
        const port = this.opts.port ?? 4723;
        throw new Error(
          `Không kết nối được với Appium tại ${host}:${port}.\n` +
          `Appium server chưa chạy hoặc vừa bị dừng.\n` +
          `Trên Horus, mở Local Runner → Yêu cầu trước khi chạy → bấm “Khởi động”, ` +
          `chờ trạng thái “Appium đã sẵn sàng”, rồi chạy lại.\n` +
          `Lưu ý: F5 chỉ tải lại giao diện, không khởi động Appium.`,
        );
      }
      if (msg.includes('Failed to get PID') || msg.includes('app is not running')) {
        throw new Error(
          `App chưa mở trên điện thoại.\n` +
          `Hãy mở app thủ công trước khi chạy test android để tránh biometric khi cold-start:\n` +
          `  1. Mở app trên điện thoại\n` +
          `  2. Đợi app load xong (màn hình chính hoặc login)\n` +
          `  3. Chạy lại lệnh test`,
        );
      }
      if (msg.includes('ANDROID_HOME') || msg.includes('ANDROID_SDK_ROOT')) {
        throw new Error(
          `Appium thiếu biến môi trường ANDROID_HOME.\n` +
          `Hãy khởi động Appium từ terminal đã load shell profile, hoặc chạy:\n` +
          `  export ANDROID_HOME=$HOME/Library/Android/sdk\n` +
          `  export ANDROID_SDK_ROOT=$HOME/Library/Android/sdk\n` +
          `  appium\n` +
          `Để fix vĩnh viễn, thêm 2 dòng export trên vào ~/.zprofile (macOS) hoặc ~/.bashrc (Linux).`,
        );
      }
      throw err;
    }

    // A second sweep, now that there is a session to press buttons with. The
    // pre-session one can only send Back, which unblocks the screen but leaves
    // a permission unanswered — so the app asks again on the next launch.
    // Starting the session is also what raises the first-launch dialogs on a
    // device the app was just installed on, so this is when they exist.
    await this.clearBlockingDialogs();

    // Do NOT call enterWebview() here — the app has just been attached but no
    // scenario has run yet, so no screen is guaranteed to have a WebView. Each
    // scenario calls launch() which enters the WebView only if one is present.

    if (this.opts.hybrid && this.opts.platform === 'android') {
      this.cdpDriver = new WebViewCdpDriver(
        this.opts.appPackage ?? '',
        this.opts.deviceSerial,
        this.opts.popupRules,
      );
      await this.cdpDriver.connect().catch((err) => {
        // Non-fatal: CDP is optional. Continue with chromedriver path.
        console.warn(
          `[native] CDP connect failed (continuing without Playwright): ${(err as Error).message}`,
        );
        this.cdpDriver = undefined;
      });
    }
  }

  async stop(): Promise<void> {
    // Written before the session goes away, and unconditionally: the run that
    // most needs a network log is the one that failed, and that is exactly the
    // run nobody thought to turn logging on for.
    if (this.cdpDriver) {
      await writeFile(
        path.join(this.opts.artifactsDir, 'network.log'),
        this.cdpDriver.networkLog(),
        'utf8',
      ).catch((err) => {
        console.warn(`[native] không ghi được network.log: ${(err as Error).message}`);
      });
    }
    await this.cdpDriver?.disconnect().catch(() => {});
    this.cdpDriver = undefined;
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
        // Warm-start the app (FLAG_ACTIVITY_REORDER_TO_FRONT) so the process is
        // never killed. Cold-start triggers biometric re-auth on banking apps that
        // have a saved session; warm-start skips it entirely.
        await this.activateApp(id);
        // First-launch dialogs land on top of the app, not of the WebView, so
        // they have to be cleared here rather than left to the resolver.
        await this.clearBlockingDialogs();
        if (this.opts.hybrid) {
          this.webview = undefined;
          // Asking Appium to enter the WebView is what collides with our own
          // CDP session, so it is only asked when we have no CDP session.
          if (!this.cdpConnected) await this.tryEnterWebview();
          if (this.inWebview || this.cdpConnected) await this.resetWebView();
          if (this.cdpDriver) {
            await this.cdpDriver.reconnect().catch((err) => {
              console.warn(`[native] CDP reconnect failed: ${(err as Error).message}`);
              this.cdpDriver = undefined;
            });
          }
          return;
        }
      } else {
        await this.activateApp(id);
        // Same reason as the Android branch above: bringing the app forward is
        // what makes iOS ask for notifications, and that alert covers the
        // WebView the next step is about to search.
        await this.clearBlockingDialogs();
      }
    }
    this.webview = undefined;
    if (this.opts.hybrid && !this.cdpConnected) await this.tryEnterWebview();
    if (this.cdpDriver) {
      await this.cdpDriver.reconnect().catch((err) => {
        console.warn(`[native] CDP reconnect failed: ${(err as Error).message}`);
        this.cdpDriver = undefined;
      });
    }
  }

  /**
   * Clears all app data via `pm clear` — wipes storage, cookies, SharedPreferences,
   * and Keystore entries so no saved session or biometric credential survives.
   * The app starts as if freshly installed; permission dialogs are handled by
   * the existing popup-dismiss rules in the config.
   */
  private async resetWebView(): Promise<void> {
    // Whichever client holds the WebView runs this. With CDP attached, Appium
    // is not in the WebView context at all, so its execute() would run the
    // script against the native session and quietly clear nothing — leaving
    // scenario 2 logged in as scenario 1.
    const page = this.cdpConnected ? this.cdpDriver?.getPage() ?? null : null;
    const run = async (script: string): Promise<void> => {
      const call = page ? page.evaluate(script) : this.b.execute(script);
      await Promise.race([
        call,
        new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref?.()),
      ]);
    };

    try {
      // Clear all browser-side auth storage so the SPA redirects to login.
      await run(`
        try { localStorage.clear(); } catch(e) {}
        try { sessionStorage.clear(); } catch(e) {}
        try {
          document.cookie.split(';').forEach(function(c) {
            document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
          });
        } catch(e) {}
        try {
          if (indexedDB && indexedDB.databases) {
            indexedDB.databases().then(function(dbs) {
              dbs.forEach(function(db) { if(db.name) indexedDB.deleteDatabase(db.name); });
            });
          }
        } catch(e) {}
      `);
      // Navigate to app root — SPA router redirects to login when unauthenticated.
      // Navigate via JS — avoids chromedriver's URL command which triggers
      // DNS resolution and fails with ERR_NAME_NOT_RESOLVED on Capacitor origins.
      await run('window.location.href = window.location.origin + "/"');
      await new Promise(r => setTimeout(r, 800));
    } catch { /* if WebView navigation fails, let the scenario handle state */ }
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
    // Bounded. getContexts() has no timeout of its own and can simply never
    // answer — a stuck chromedriver is enough — which turns a slow probe into a
    // dead run with nothing in the log.
    const raw = (await Promise.race([
      this.b.getContexts(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getContexts không trả lời sau 8s')), 8_000).unref?.(),
      ),
    ])) as Array<string | { id?: string }>;
    return raw.map((c) => (typeof c === 'string' ? c : (c.id ?? ''))).filter(Boolean);
  }

  /**
   * Best-effort WebView entry: tries to switch context, but if none is found
   * (e.g. current screen is native-only like a login form) stays in native mode
   * and logs a warning instead of throwing. Callers that need WebView
   * unconditionally should use enterWebview() directly.
   */
  private async tryEnterWebview(): Promise<void> {
    // A warm app on a desk attaches its WebView in well under a second, which is
    // where the old 4 s probe came from. A farm device cold-starting a freshly
    // installed build does not, and giving up there is not a slow scenario but a
    // wrong one: a Capacitor app has no native UI to fall back to, so every
    // locator after that misses and the run fails somewhere unrelated.
    const budget = this.opts.webviewTimeoutMs ?? 4_000;
    try {
      await this.enterWebview(budget);
      this.webviewUnavailable = false;
      return;
    } catch {
      this.webviewUnavailable = true;
      console.warn(
        `[native] No WebView found within ${Math.round(budget / 1000)}s — running in native context. ` +
          'For a hybrid app this usually means the run is about to fail; raise ' +
          '<platform>.webviewTimeoutMs if the device is simply slow.',
      );
    }
  }

  /**
   * Polls until a WebView context shows up, then switches into it.
   *
   * The failure here is worth a long message: by far the most common cause is
   * not a timing problem but a build setting. Appium can only attach to a
   * WebView the app has explicitly made inspectable, and release builds
   * normally have not.
   */
  private async enterWebview(timeoutMs?: number): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? this.opts.webviewTimeoutMs ?? 30_000);
    let seen: string[] = [];

    for (;;) {
      seen = await this.contextNames();
      const found = pickWebviewContext(seen);
      if (found) {
        try {
          await this.b.switchContext(found);
          this.webview = found;
          return;
        } catch {
          // Context listed but chromedriver can't attach — WebView not debuggable.
          // Keep polling in case a different context appears, or fall through to timeout.
        }
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
   * Whether the CDP delegate can be used for this operation.
   *
   * It used to require Appium to have switched into a WEBVIEW context, and that
   * coupling is simply wrong: WebViewCdpDriver reaches the WebView through an
   * adb port-forward to its devtools socket and never asks Appium anything. The
   * two only travelled together because, on a developer's machine, they both
   * work.
   *
   * On a Device Farm host they do not. Appium there never lists a WEBVIEW
   * context, so a connected CDP session sat idle while every locator was tried
   * as a native UiSelector against a Capacitor app whose entire UI is DOM —
   * which is why the farm failed at the first element the accessibility tree
   * did not happen to expose.
   */
  /**
   * Whether Playwright currently holds the app's WebView over CDP.
   *
   * When it does, that IS the way into the DOM and Appium is not asked for a
   * WebView context at all — see launch(). A WebView accepts one DevTools
   * client: with Playwright attached through an adb port-forward, the
   * chromedriver Appium spawns for `getContexts()` cannot attach, and the call
   * never returns. That was the hang, reproducible straight from curl against
   * Appium with no project code in the path, and visible as `chrome_devtools_remote`
   * forwards piling up one per attempt.
   */
  private get cdpConnected(): boolean {
    return Boolean(this.cdpDriver?.getPage());
  }

  /**
   * Says which build is actually about to run, before the session starts.
   *
   * Placed here on purpose: once `remote()` returns, an absent app has been
   * installed and the two versions agree, so the interesting case — a device
   * quietly keeping an older build — can only be seen beforehand. Reported and
   * never enforced; see checkAppVersion for why.
   */
  private async warnOnAppVersionSkew(): Promise<void> {
    if (!this.opts.app || !this.opts.appPackage) return;
    try {
      const check = await checkAppVersion({
        apkPath: this.opts.app,
        appPackage: this.opts.appPackage,
        ...(this.opts.deviceSerial ? { deviceSerial: this.opts.deviceSerial } : {}),
      });
      if (check.status === 'mismatch') console.warn(`[native] ⚠ ${check.message}`);
      else if (check.status !== 'match') console.log(`[native] ${check.message}`);
    } catch (err) {
      // A version check must never be the reason a suite cannot start.
      console.warn(`[native] bỏ qua kiểm tra phiên bản app: ${(err as Error).message}`);
    }
  }

  /**
   * Grants every runtime permission the app has asked for and not been given.
   *
   * `appium:autoGrantPermissions` already asks for this, but it only takes
   * effect while *installing*, and `isolation: 'restart'` sets `noReset` so the
   * app is never reinstalled. The two settings silently cancel out: the
   * capability looks like it covers this and does nothing. The symptom is not a
   * permission error but a locator one — TCInvest's notification prompt sits on
   * top of the login screen as a *native* dialog, invisible to a WebView search,
   * so every candidate misses and the failure points at the wrong layer
   * entirely (396 attempts against a DOM that never contained the answer).
   *
   * Best-effort: a device that is not reachable, or a permission the platform
   * refuses, must not stop the run.
   */
  private async grantPendingPermissions(): Promise<void> {
    const pkg = this.opts.appPackage;
    if (!pkg) return;
    const serial = this.opts.deviceSerial ? `-s ${this.opts.deviceSerial} ` : '';

    try {
      const { stdout } = await execAsync(`adb ${serial}shell dumpsys package ${pkg}`, {
        maxBuffer: 8 * 1024 * 1024,
      });
      // Runtime permissions are reported as `<name>: granted=false, flags=[...]`.
      const pending = [
        ...new Set(
          [...stdout.matchAll(/^\s*([\w.]+\.permission\.[\w]+): granted=false/gm)].map(
            (m) => m[1]!,
          ),
        ),
      ];
      if (pending.length === 0) return;

      for (const perm of pending) {
        // Install-time permissions cannot be granted this way and simply error;
        // that is expected and not worth reporting.
        await execAsync(`adb ${serial}shell pm grant ${pkg} ${perm}`).catch(() => {});
      }
      console.log(`[native] granted ${pending.length} pending runtime permission(s) to ${pkg}`);
    } catch (err) {
      console.warn(`[native] permission grant skipped: ${(err as Error).message}`);
    }
  }

  private async killWebViewApps(): Promise<void> {
    const serial = this.opts.deviceSerial ? `-s ${this.opts.deviceSerial} ` : '';
    const pkg = this.opts.appPackage;
    // Apps known to expose debuggable WebViews that confuse chromedriver.
    const competitors = ['com.facebook.katana', 'com.facebook.orca', 'com.instagram.android'];
    for (const app of competitors) {
      if (app === pkg) continue;
      await execAsync(`adb ${serial}shell am force-stop ${app}`).catch(() => {});
    }
  }

  async dismissOverlay(protect: string[] = []): Promise<boolean> {
    if (this.opts.platform !== 'android') return false;
    // When the application UI is a WebView, use the same safe DOM interceptor
    // as local web first. This avoids an expensive and destabilising Appium
    // context round-trip for ordinary Material/CDK/application dialogs.
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      const dismissed = await this.cdpDriver.dismissOverlay(protect).catch(() => false);
      if (dismissed) return true;
    }
    // Throttle to once every 5s — rapid NATIVE↔WebView context switching
    // destabilises the UiAutomator2 instrumentation process.
    const now = Date.now();
    if (now - this.lastOverlayCheck < 5000) return false;
    this.lastOverlayCheck = now;
    const pressed = await this.tapNativeButton();
    if (pressed) console.log(`[native] dismissed native overlay by tapping "${pressed}"`);
    return Boolean(pressed);
  }

  /**
   * Clears system windows that are covering the app.
   *
   * These are not found by the resolver, which is why they used to survive a
   * whole run: with Playwright reading the DOM over CDP, a locator still
   * resolves perfectly while a system dialog is drawn on top, so nothing ever
   * failed and nothing ever called dismissOverlay(). The run passed and the
   * screenshots showed a permission sheet. A fresh install is where it bites,
   * because that is when Android asks everything at once.
   *
   * Dialogs stack — dismissing the fingerprint prompt reveals the notification
   * request behind it — so this loops until the app owns the focus again.
   *
   * What it presses depends on which window is up, deliberately. Samsung's
   * BiometricPrompt offers exactly one button, "Dùng mã PIN", which opens a PIN
   * pad the run can never complete; tapping "whatever is clickable" walks
   * straight into it. Back is the only exit from that one, while a permission
   * request is answered by its own Allow button so the app stops asking.
   */
  private async clearBlockingDialogs(rounds = 5): Promise<void> {
    if (this.opts.platform !== 'android') return this.clearIosAlerts(rounds);
    for (let round = 0; round < rounds; round += 1) {
      const focus = await this.focusedWindow();
      const kind = blockingKind(focus, this.opts.appPackage);
      if (!kind) return;

      const pressed = kind === 'permission' ? await this.tapNativeButton() : null;
      if (!pressed) await this.pressBack();
      console.log(`[native] dọn cửa sổ hệ thống (${kind})${pressed ? ` bằng "${pressed}"` : ' bằng phím Back'}`);
      await sleep(600);
    }
    const left = await this.focusedWindow();
    if (blockingKind(left, this.opts.appPackage)) {
      console.warn(`[native] vẫn còn cửa sổ hệ thống che màn hình sau ${rounds} lần thử: ${left}`);
    }
  }

  /**
   * The iOS counterpart: dismisses the alerts iOS puts in front of a launching
   * app — notifications, tracking, location — which sit above the WebView and
   * make every locator miss for a reason that has nothing to do with the app.
   *
   * Unlike Android there is no window manager to interrogate, so the alert
   * itself is the signal: XCUITest raises an error when none is present, and
   * that error is the loop's exit condition rather than a failure.
   *
   * A named button is chosen from a fixed list instead of blindly accepting.
   * `autoDismissAlerts` would have been one capability, but it answers every
   * alert for the whole session — including one a scenario means to assert on,
   * the same trap the popup interceptor had to be taught to avoid.
   */
  private async clearIosAlerts(rounds: number): Promise<void> {
    if (!this.browser) return;
    for (let round = 0; round < rounds; round += 1) {
      let buttons: string[];
      try {
        buttons = (await this.b.execute('mobile: alert', { action: 'getButtons' })) as string[];
      } catch {
        return; // no alert on screen — the normal way out
      }
      if (!Array.isArray(buttons) || buttons.length === 0) return;

      const choice = IOS_ALERT_BUTTONS.find((label) => buttons.includes(label));
      if (!choice) {
        console.warn(
          `[native] hộp thoại iOS có nút [${buttons.join(', ')}] — không nút nào nằm trong danh sách an toàn, để nguyên.`,
        );
        return;
      }
      await this.b
        .execute('mobile: alert', { action: 'accept', buttonLabel: choice })
        .catch(() => {});
      console.log(`[native] đóng hộp thoại iOS bằng "${choice}"`);
      await sleep(600);
    }
  }

  /** `mCurrentFocus`/`mFocusedApp` as one string — cheap, read-only, no accessibility conflict. */
  private async focusedWindow(): Promise<string> {
    const serial = this.opts.deviceSerial ? `-s ${this.opts.deviceSerial} ` : '';
    try {
      const { stdout } = await execAsync(
        `adb ${serial}shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp"`,
        { timeout: 10_000, maxBuffer: 1024 * 1024 },
      );
      return stdout.replace(/\s+/g, ' ').trim();
    } catch {
      // Unknown focus must not be read as "something is blocking"; a failed
      // probe would otherwise press Back into the app on every launch.
      return '';
    }
  }

  private async pressBack(): Promise<void> {
    const serial = this.opts.deviceSerial ? `-s ${this.opts.deviceSerial} ` : '';
    await execAsync(`adb ${serial}shell input keyevent 4`, { timeout: 10_000 }).catch(() => {});
  }

  /** Taps the first known dialog button that is present. Returns its label. */
  private async tapNativeButton(): Promise<string | null> {
    return this.asNative(async () => {
      for (const sel of NATIVE_DIALOG_BUTTONS) {
        try {
          const el = await this.b.$(sel);
          if (!(await el.isExisting())) continue;
          const label = await el.getText().catch(() => sel);
          await el.click();
          return label || sel;
        } catch { /* selector not found or stale — try next */ }
      }
      return null;
    });
  }

  /**
   * Runs a native-only command (the `mobile:` gestures all are) with the  /**
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
      // Appium context switches redirect the ADB forward away from the app's
      // WebView socket to the WEBVIEW_chrome socket. Re-establish the forward
      // so CDP stays connected to the app after any NATIVE→WEBVIEW cycle.
      if (this.cdpDriver) {
        await this.cdpDriver.reconnect().catch((err) => {
          console.warn(`[native] CDP re-forward after asNative failed: ${(err as Error).message}`);
          this.cdpDriver = undefined;
        });
      }
    }
  }

  async find(c: LocatorCandidate): Promise<UiHandle | null> {
    // CDP-first path for WebView: Playwright sees the full Angular DOM (formcontrolname,
    // data-testid, aria-label) while chromedriver is blind to those attributes.
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      try {
        const handle = await this.cdpDriver.find(c);
        if (handle !== null) return handle;
        // null means element not in DOM — fall through to chromedriver
      } catch (err) {
        if (isCdpSessionLost(err)) {
          await this.cdpDriver.reconnect().catch(() => {
            this.cdpDriver = undefined;
          });
        }
        // Fall through to chromedriver on any CDP error
      }
    }

    // Selectors such as :has-text() and :text() are Playwright extensions, not
    // browser CSS. If CDP did not find them, sending them to Chromedriver only
    // produces a noisy "invalid selector" server error and cannot succeed.
    if (this.inWebview && c.strategy === 'css' && isPlaywrightOnlyCss(c.value)) {
      return null;
    }

    const selector = this.toSelector(c);
    try {
      // Deliberately one round trip: every extra probe here is paid on each of
      // the resolver's polling ticks, and on a real farm device that is ~100 ms
      // apiece. Viewport disambiguation lives in the CDP/web path, where the
      // box and the viewport come from the same page and use the same units;
      // here the context can flip between native pixels and WebView CSS pixels,
      // so the same comparison is both expensive and wrong.
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

  async inspectMatches(candidate: LocatorCandidate): Promise<UiMatchSnapshot> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      return this.cdpDriver.inspectMatches(candidate);
    }
    const elements = await this.b.$$(this.toSelector(candidate)) as unknown as WdioElement[];
    const texts: string[] = [];
    const focused: number[] = [];
    for (const element of elements.slice(0, 100)) {
      if (!(await element.isDisplayed().catch(() => false))) continue;
      const index = texts.length;
      texts.push((await element.getText().catch(() => '')).replace(/\s+/g, ' ').trim());
      const selected = await element.getAttribute('focused').catch(() => null)
        ?? await element.getAttribute('selected').catch(() => null)
        ?? await element.getAttribute('checked').catch(() => null);
      if (selected === 'true') focused.push(index);
    }
    return { count: texts.length, texts, focused };
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
      case 'relative':
        throw new Error('The "relative" strategy is WebView-only and has no native equivalent.');
      case 'css':
        throw new Error('The "css" strategy is web-only and has no native equivalent.');
    }
  }

  private toDomSelector(c: LocatorCandidate): string {
    return domSelector(c);
  }

  async tap(h: UiHandle): Promise<void> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      await this.cdpDriver.tap(h);
      return;
    }
    await (h as NativeHandle).el.click();
  }

  async hover(h: UiHandle): Promise<void> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      await this.cdpDriver.hover(h);
      return;
    }
    if (this.inWebview) {
      await this.b.action('pointer').move({ origin: (h as NativeHandle).el }).perform();
      return;
    }
    throw new Error('Hover cần web hoặc WebView; native Android/iOS không có con trỏ.');
  }

  async dragDrop(source: UiHandle, target: UiHandle): Promise<void> {
    if (
      this.inWebview &&
      this.cdpDriver &&
      source instanceof WebViewCdpHandle &&
      target instanceof WebViewCdpHandle
    ) {
      await this.cdpDriver.dragDrop(source, target);
      return;
    }
    const from = (source as NativeHandle).el;
    const to = (target as NativeHandle).el;
    await this.b.action('pointer')
      .move({ origin: from })
      .down()
      .pause(300)
      .move({ origin: to, duration: 800 })
      .up()
      .perform();
  }

  async longPress(h: UiHandle, ms: number): Promise<void> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      return this.cdpDriver.longPress(h, ms);
    }
    const el = (h as NativeHandle).el;
    if (!el) {
      throw new Error(
        'Không nhấn giữ được: handle không phải element native và cũng không nối được WebView.',
      );
    }
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

  async input(h: UiHandle, text: string, typeDelay?: number): Promise<void> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      await this.cdpDriver.fill(h, text, typeDelay);
      return;
    }
    const el = (h as NativeHandle).el;
    if (this.inWebview) {
      // WebDriverIO's setValue() does not trigger Angular's reactive-form change detection
      // in a WebView (chromedriver). The native HTMLInputElement value setter + dispatching
      // 'input' is the framework-agnostic way to set a value that Angular/React will see.
      await el.click();
      await this.b.execute(
        `var e=arguments[0],v=arguments[1];` +
        `var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;` +
        `if(s)s.call(e,v);else e.value=v;` +
        `e.dispatchEvent(new Event('input',{bubbles:true}));` +
        `e.dispatchEvent(new Event('change',{bubbles:true}));` +
        `e.dispatchEvent(new KeyboardEvent('keyup',{key:'Process',bubbles:true}));`,
        el,
        text,
      );
      return;
    }
    await el.clearValue();
    await el.setValue(text);
  }

  async selectDate(h: UiHandle, date: string): Promise<void> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      await this.cdpDriver.selectDate(h, date);
      return;
    }
    const el = (h as NativeHandle).el;
    await el.click();
    await el.clearValue().catch(() => {});
    await el.setValue(date);
  }

  async inspectControl(h: UiHandle): Promise<ControlInspection> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      return this.cdpDriver.inspectControl(h);
    }
    return { type: 'unknown', evidence: [`appium-native: ${this.opts.platform}`] };
  }

  async clear(h: UiHandle): Promise<void> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      await this.cdpDriver.clear(h);
      return;
    }
    const el = (h as NativeHandle).el;
    if (this.inWebview) {
      await el.click();
      await this.b.execute(
        `var e=arguments[0];` +
        `var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;` +
        `if(s)s.call(e,'');else e.value='';` +
        `e.dispatchEvent(new Event('input',{bubbles:true}));`,
        el,
      );
      return;
    }
    await el.clearValue();
  }

  async selectOption(h: UiHandle, option: string): Promise<void> {
    // Routed like tap/input: with CDP driving the DOM the handle is a
    // WebViewCdpHandle, which has no `.el` — the cast below would have thrown
    // on the very first use. Every other action already had this branch; this
    // one was simply missed, and stayed hidden while Android ran natively.
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      return this.cdpDriver.selectOption(h, option);
    }
    // Native pickers have no <select>: open the control, then tap the option by label.
    await (h as NativeHandle).el.click();
    const opt = await this.find({ strategy: 'label', value: option, weight: 1, origin: 'authored' });
    if (!opt) throw new Error(`Option "${option}" did not appear after opening the picker.`);
    await this.tap(opt);
  }

  /**
   * Routed to the WebView like tap/selectOption/scrollIntoView.
   *
   * A native accessibility tree has no notion of "the value beside this
   * caption", so there is no native branch to fall back to: outside a WebView
   * this reports nothing and the executor keeps the text it already had.
   */
  async captionValue(h: UiHandle): Promise<string | undefined> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      return this.cdpDriver.captionValue(h);
    }
    return undefined;
  }

  async scrollIntoView(h: UiHandle): Promise<void> {
    // Same routing as tap/selectOption. Without it a WebView handle fell
    // through to the native branch, where `.el` does not exist — and the step
    // died on `Cannot read properties of undefined (reading 'elementId')`,
    // which says nothing about scrolling or about the element being off-screen.
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver && h instanceof WebViewCdpHandle) {
      return this.cdpDriver.scrollIntoView(h);
    }
    const el = (h as NativeHandle).el;
    if (!el) {
      throw new Error(
        'Không cuộn được: handle không phải element native và cũng không nối được WebView. ' +
          'App hybrid cần phiên CDP còn sống để cuộn trong WebView.',
      );
    }
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
    // Vertical swipes in a hybrid app almost always mean "scroll the page".
    // Doing it in JS is both faster and more reliable than a native fling,
    // which the WebView may swallow or turn into a pull-to-refresh.
    if (direction === 'up' || direction === 'down') {
      if (this.inWebview) {
        await this.b.execute(
          'window.scrollBy({top: arguments[0] * window.innerHeight * 0.8, behavior: "instant"})',
          direction === 'down' ? 1 : -1,
        );
        return;
      }
      // The CDP path reaches the same page without switching contexts. Checked
      // separately because `inWebview` is false there, and a run driving the
      // WebView through CDP was still flinging natively at it.
      if (this.cdpConnected && this.cdpDriver && (await this.cdpDriver.scrollPage(direction))) {
        return;
      }
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
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      return this.cdpDriver.dumpDom(name, this.opts.artifactsDir);
    }
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
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      try {
        const obs = await this.cdpDriver.observe();
        return obs.elements.map((el, i) => convertObservedElement(el, i));
      } catch {
        // Fall through to native XML on any CDP error
      }
    }
    const xml = await this.getPageSource();
    return parseUiAutomatorXml(xml);
  }

  async observeAccessibility(): Promise<Observed[]> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      return this.cdpDriver.observeAccessibility();
    }
    return [];
  }

  /**
   * Native has no `networkidle`, so "idle" means the view hierarchy stopped
   * changing between two consecutive samples. Cheap, and it catches the common
   * case of asserting into a running transition.
   */
  async isIdle(): Promise<boolean> {
    if ((this.inWebview || this.cdpConnected) && this.cdpDriver) {
      return this.cdpDriver.isIdle();
    }
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
        //
        // `name` and `formcontrolname` belong here too: observation treats them
        // as developer-written identity — which is what a testId is — and an app
        // built without data-testid has nothing else to offer. Discovery found
        // the right field, emitted `ticker`, and the lookup then searched only
        // for a data-testid that the app has never had.
        const v = cssEscape(c.value);
        return `[data-testid="${v}"],[data-test="${v}"],[data-cy="${v}"],` +
          `[name="${v}"],[formcontrolname="${v}"]`;
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

      case 'label':
        // Shared with the web driver — see core/labelXPath.ts for why the arms
        // are what they are.
        return labelXPaths(c.value).join(' | ');

      case 'css':
        return c.value;

      case 'xpath':
        return c.value.startsWith('/') ? c.value : `//${c.value}`;

      case 'relative': {
        const xpath = relativeRowLocatorXPath(c.value);
        if (!xpath) throw new Error(`Relative locator không hợp lệ: ${c.value}`);
        return `xpath=${xpath}`;
      }

      case 'predicate':
        throw new Error(
          'Chiến lược "predicate" là của native iOS, không dùng được trong WebView. ' +
            'Dùng css hoặc xpath cho app hybrid.',
        );
    }
}

function isPlaywrightOnlyCss(value: string): boolean {
  return /:(?:has-text|text|text-is|text-matches)\s*\(/.test(value) || value.includes('>>');
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

/** Webdriver/fetch sometimes exposes the useful socket code only on `cause`. */
function errorMessageChain(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current) && messages.length < 6) {
    seen.add(current);
    if (current instanceof Error) {
      if (current.message) messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages.join('\n');
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
 * Maps an ObservedElement (rich UiObservation format) to the flatter Observed
 * type that native.ts observe() returns, so CDP observations are compatible with
 * the existing crawler/registry pipeline.
 */
function convertObservedElement(
  el: import('../discovery/UiObservation.js').ObservedElement,
  index: number,
): Observed {
  return {
    testId: el.testId,
    role: el.role,
    name: el.accessibilityLabel,
    text: el.text,
    placeholder: el.placeholder,
    resourceId: el.resourceId,
    // Pass through the CSS selector from CDP observe() so candidatesFor()
    // can emit a stable `css` strategy candidate during healing.
    css: el.css,
    interactive: el.interactive ?? false,
    index,
    container: (el.childIds?.length ?? 0) > 0,
  };
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
