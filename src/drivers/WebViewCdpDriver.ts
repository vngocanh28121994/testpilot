/**
 * WebViewCdpDriver — CDP/Playwright delegate for WebView interactions.
 *
 * NOT a full UiDriver. Used by NativeUiDriver as a higher-fidelity alternative
 * to chromedriver for find/tap/fill/observe operations inside a WebView.
 *
 * Why Playwright/CDP instead of chromedriver:
 *   - chromedriver's observe() returns native UiAutomator2 XML that is blind to
 *     Angular DOM attributes (formcontrolname, data-testid, aria-label).
 *   - CDP sees the full Angular DOM: 1475+ elements, formcontrolname, aria-label.
 *   - Phase W0 POC confirmed chromium.connectOverCDP is fast and stable.
 *
 * All CDP errors are non-fatal: callers fall through to chromedriver on failure.
 */

import { exec as execCb } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Browser, Locator, Page } from 'playwright';
import type { LocatorCandidate } from '../core/types.js';
import { protectedSelectors, type ControlInspection, type UiHandle, type UiMatchSnapshot } from './driver.js';
import { labelContainsXPath, labelSplitAcrossChildrenXPath } from '../core/labelXPath.js';
import type { ObservedElement, UiObservation } from '../discovery/UiObservation.js';
import { domSelector } from './native.js';
import { PopupInterceptor, type PopupRule } from './PopupInterceptor.js';
import { toRelativePlaywrightLocator } from './relativeLocator.js';
import { isHittable } from './viewport.js';
import { PlaywrightMcpObserver } from '../discovery/mcp/PlaywrightMcpObserver.js';
import type { Observed } from '../crawl/observe.js';
import { selectDateWithPlaywright } from './datePicker.js';
import { inspectPlaywrightControl } from './controlClassifier.js';
import { accessibleNameOf } from './accessibleName.js';
import { valueBesideCaption } from './captionValue.js';
import { openOptionLabels } from './options.js';

const exec = promisify(execCb);

/**
 * Protects the layer holding the element an action is about to touch.
 *
 * Clearing overlays before acting is right — a notice can appear between two
 * steps — but the element being acted on is sometimes inside a dialog, and the
 * interceptor would press that dialog's "ĐÓNG" on the way to pressing its
 * "Xác nhận". XPath handles protect nothing: the guard is a CSS query.
 */
/**
 * What the popup interceptor must not dismiss while acting on this element.
 *
 * The selector alone is not enough, and used to be all there was: an xpath has
 * no in-page CSS equivalent, so this returned an empty list and the interceptor
 * was told to protect nothing. Most locators here resolve to xpath, so most
 * elements were unprotected — and the interceptor duly clicked the ĐÓNG button
 * of the app's own validation dialog, the exact button the step was about to
 * click, then reported that the click had failed for want of a target.
 *
 * So the layer containing the element is protected too. Overlay panes and
 * Material dialogs carry ids (`#mat-dialog-1` is what the log named), which is
 * exactly the kind of selector the interceptor already understands.
 */
async function keep(handle: WebViewCdpHandle): Promise<string[]> {
  const own = handle.selector.startsWith('/') ? [] : [handle.selector];
  const layer = await handle
    .locator()
    .evaluate((node) => {
      const root = (node as Element).closest(
        '.cdk-overlay-pane, mat-dialog-container, [role="dialog"], [aria-modal="true"]',
      );
      return root && root.id ? `#${root.id}` : null;
    })
    .catch(() => null);
  return layer ? [...own, layer] : own;
}

/**
 * An unused TCP port from the OS ephemeral range.
 *
 * Asked for at connect time so concurrent device sessions never share one. The
 * gap between closing this probe and adb binding the port is a theoretical
 * race; the OS hands out ephemeral ports round-robin, so in practice two
 * sessions seconds apart do not collide.
 */
async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * Ids frameworks hand out by counter rather than by meaning.
 *
 * Angular Material renumbers `mat-input-0`, `mat-select-14`, `cdk-overlay-6` on
 * every rebuild of the view, so one is a valid selector for exactly as long as
 * the page stands still. Treating them as identity produced healed locators
 * that were already wrong by the next run.
 */
function isGeneratedId(id: string | undefined): boolean {
  return Boolean(id && /^(mat-|cdk-|ng-|ngb-|_ngcontent|pn_id)/.test(id));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Handle ────────────────────────────────────────────────────────────────────

/**
 * A live reference to a DOM element found via CDP.
 * Exported so NativeUiDriver can use `instanceof WebViewCdpHandle` to route
 * tap/input/clear through the CDP path.
 */
export class WebViewCdpHandle implements UiHandle {
  constructor(
    readonly candidate: LocatorCandidate,
    readonly page: Page,
    readonly selector: string, // CSS or XPath, as returned by domSelector()
    readonly scope?: string,   // runtimeScope from the resolver, if any
    readonly directLocator?: Locator,
  ) {}

  /** Returns a Playwright Locator scoped within the active page area when a scope is set. */
  locator() {
    if (this.directLocator) return this.directLocator.first();
    const root = this.scope ? this.page.locator(this.scope) : this.page;
    return root.locator(this.selector).first();
  }

  async isVisible(): Promise<boolean> {
    try {
      return await this.locator().isVisible({ timeout: 1000 });
    } catch {
      return false;
    }
  }

  async text(): Promise<string> {
    try {
      return (await this.locator().innerText({ timeout: 1000 })).trim();
    } catch {
      return '';
    }
  }

  async accessibleName(): Promise<string | undefined> {
    // Not swallowed silently: a page-side throw here used to look identical to
    // "this element has no name", and the resolver then rejected a correct
    // match for a reason nothing recorded.
    return this.locator()
      .evaluate(accessibleNameOf)
      .catch((err: Error) => {
        console.log(`[a11y] không đọc được tên của ${this.candidate.strategy}:${this.candidate.value}: ${err.message.split('\n')[0]}`);
        return undefined;
      });
  }

  /**
   * Current value for inputs; null for non-inputs.
   */
  async value(): Promise<string | null> {
    try {
      return await this.locator().inputValue({ timeout: 1000 });
    } catch {
      return null;
    }
  }


  async selected(): Promise<boolean | undefined> {
    try {
      return await this.locator().evaluate((node) => {
        const el = node as HTMLElement;
        const aria = el.getAttribute('aria-selected') ?? el.getAttribute('aria-checked');
        if (aria === 'true') return true;
        if (aria === 'false') return false;
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          return el.checked;
        }
        return ['selected', 'active', 'current'].some((name) => el.classList.contains(name))
          ? true
          : undefined;
      });
    } catch {
      return undefined;
    }
  }
}

// ── Driver ────────────────────────────────────────────────────────────────────

/** One line of the network log. Metadata only — see instrumentNetwork(). */
export interface NetworkEntry {
  at: string;
  method: string;
  /** Origin + path. Query is dropped; see instrumentNetwork(). */
  url: string;
  resourceType: string;
  status?: number;
  durationMs?: number;
  failure?: string;
}

export class WebViewCdpDriver {
  private browser?: Browser;
  /** Everything the WebView asked for this session, oldest first. */
  private readonly network: NetworkEntry[] = [];
  private page?: Page | null;
  private mcpObserver?: PlaywrightMcpObserver;
  private cdpPort?: number;
  /** True once a stall has been logged; reset by any successful CDP call. */
  private stallReported = false;
  private readonly popupInterceptor: PopupInterceptor;

  constructor(
    private readonly appPackage: string,
    private readonly deviceSerial?: string,
    popupRules: PopupRule[] = [],
  ) {
    this.popupInterceptor = new PopupInterceptor(popupRules);
  }

  /**
   * Connect: find the app PID via adb, forward the devtools socket, and attach
   * Playwright via CDP.
   *
   * The forwarding port is picked per session rather than fixed. A constant was
   * fine while one phone ran at a time, but two devices in parallel both
   * forwarded the same port — and the `--remove` below, meant to clear a stale
   * forward, deleted the other device's live one. Whichever session connected
   * second silently lost its WebView and fell back to native locators against a
   * UI that has none.
   */
  async connect(port = 0): Promise<void> {
    const serialFlag = this.deviceSerial ? `-s ${this.deviceSerial} ` : '';
    const localPort = port || (await freePort());

    // 1. Get PID — retry for up to 10s to handle the app still starting up
    let pid = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { stdout } = await exec(`adb ${serialFlag}shell pidof ${this.appPackage}`).catch(() => ({ stdout: '' }));
      pid = parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
      if (!isNaN(pid) && pid > 0) break;
      await sleep(1000);
    }
    if (isNaN(pid) || pid <= 0) {
      throw new Error(`[cdp] Could not get PID for package: ${this.appPackage}`);
    }

    // 2. Forward the devtools socket — remove stale forward first so a dead
    //    PID's socket does not shadow the new one on the same port.
    await exec(`adb ${serialFlag}forward --remove tcp:${localPort}`).catch(() => {});
    await exec(
      `adb ${serialFlag}forward tcp:${localPort} localabstract:webview_devtools_remote_${pid}`,
    );

    // 3. Poll until /json/version responds — WebView CDP HTTP server may take
    //    several seconds after app launch before it starts accepting connections.
    //    10 attempts × 3s = up to 30s total.
    let cdpReady = false;
    for (let i = 0; i < 10; i++) {
      try {
        const { stdout } = await exec(
          `curl -s --connect-timeout 2 --max-time 3 http://localhost:${localPort}/json/version`,
        );
        if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
          cdpReady = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await sleep(2000);
    }
    if (!cdpReady) {
      throw new Error(`[cdp] WebView CDP endpoint not reachable after 30s on port ${localPort} (pid ${pid})`);
    }

    // 4. Connect via Playwright (dynamic import — playwright may not be installed on farm)
    const { chromium } = await import('playwright').catch(() => {
      throw new Error('[cdp] playwright không được cài đặt trên host này');
    });
    this.browser = await chromium.connectOverCDP(`http://localhost:${localPort}`);

    // 5. Get the live page
    this.page = this.browser.contexts()[0]?.pages()[0] ?? null;
    if (this.page) this.instrumentNetwork(this.page);
    if (!this.page) {
      await this.browser.close().catch(() => {});
      this.browser = undefined;
      throw new Error(`[cdp] No page found via CDP on port ${localPort}`);
    }

    this.cdpPort = localPort;
  }

  /** Close the Playwright browser and release the adb forward. */
  async disconnect(): Promise<void> {
    await this.mcpObserver?.close().catch(() => {});
    this.mcpObserver = undefined;
    try {
      await this.browser?.close();
    } catch {
      // Ignore
    }
    this.browser = undefined;
    this.page = undefined;
  }

  async observeAccessibility(): Promise<Observed[]> {
    this.mcpObserver ??= new PlaywrightMcpObserver(() => this.page?.context());
    return this.mcpObserver.observe();
  }

  async inspectControl(handle: WebViewCdpHandle): Promise<ControlInspection> {
    const inspection = await inspectPlaywrightControl(handle.locator());
    if (inspection.type !== 'date') return inspection;
    this.mcpObserver ??= new PlaywrightMcpObserver(() => this.page?.context());
    const hints = await this.mcpObserver.controlHints('date').catch(() => []);
    return { ...inspection, evidence: [...new Set([...inspection.evidence, ...hints])] };
  }

  /** Teardown + reconnect — call when the page/context becomes stale. */
  async reconnect(port?: number): Promise<void> {
    await this.disconnect();
    await this.connect(port ?? this.cdpPort);
  }

  /**
   * Records what the WebView asked the network for.
   *
   * Metadata only, and that is a deliberate limit rather than an omission: a
   * login request carries the password in its body and the session token in its
   * headers, and this log is written to the run directory, pulled to disk, and
   * on a farm run has already travelled through S3. Nothing here should make
   * that worse. Query strings go too — tokens and OTPs live there.
   *
   * Everything is recorded, filtered only by resource type. Dropping images and
   * fonts cannot hide an API call; filtering by host could, and the whole point
   * of a log like this is catching the request nobody thought to look for.
   */
  private instrumentNetwork(page: Page): void {
    const KEEP = new Set(['xhr', 'fetch', 'document', 'websocket', 'other']);
    const started = new WeakMap<object, number>();

    const path = (raw: string): string => {
      try {
        const u = new URL(raw);
        return `${u.origin}${u.pathname}`;
      } catch {
        return raw.split('?')[0] ?? raw;
      }
    };

    page.on('request', (req) => {
      if (!KEEP.has(req.resourceType())) return;
      started.set(req, Date.now());
    });

    page.on('response', (res) => {
      const req = res.request();
      const begun = started.get(req);
      if (begun === undefined) return;
      this.network.push({
        at: new Date().toISOString(),
        method: req.method(),
        url: path(req.url()),
        resourceType: req.resourceType(),
        status: res.status(),
        durationMs: Date.now() - begun,
      });
    });

    page.on('requestfailed', (req) => {
      const begun = started.get(req);
      if (begun === undefined) return;
      this.network.push({
        at: new Date().toISOString(),
        method: req.method(),
        url: path(req.url()),
        resourceType: req.resourceType(),
        durationMs: Date.now() - begun,
        failure: req.failure()?.errorText ?? 'unknown',
      });
    });
  }

  /**
   * The network log as text, newest last.
   *
   * An empty log is itself a finding rather than a gap: a Capacitor app can
   * call its API through a native HTTP plugin instead of the WebView, and then
   * nothing here will ever see it. Said out loud so the silence is not read as
   * "no requests were made".
   */
  networkLog(): string {
    if (this.network.length === 0) {
      return 'Không ghi được request nào qua WebView.\n' +
        '(App có thể gọi API bằng plugin HTTP native, đường đó CDP không thấy.)\n';
    }
    return this.network
      .map((e) => [
        e.at,
        e.method.padEnd(6),
        e.failure ? 'FAILED' : String(e.status ?? '?').padEnd(6),
        `${e.durationMs ?? '?'}ms`.padStart(8),
        e.resourceType.padEnd(9),
        e.url,
        e.failure ? `  ← ${e.failure}` : '',
      ].join(' '))
      .join('\n') + '\n';
  }

  /** The live Playwright page, or null when not connected. */
  getPage(): Page | null {
    return this.page ?? null;
  }

  // ── Hang protection ─────────────────────────────────────────────────────────

  /**
   * Runs a CDP call under a deadline.
   *
   * Playwright's `count()`, `evaluate()` and `content()` accept no timeout of
   * their own: if the page stops answering, the promise simply never settles and
   * the run hangs rather than fails. This is plain insurance against an
   * unbounded wait — nothing here diagnoses *why* a page stopped answering, and
   * the accompanying message deliberately reports only what was observed.
   *
   * Note for anyone extending this: backgrounding the app does NOT by itself
   * stall CDP. That was measured — with the app behind the launcher, observe()
   * still returned in 18ms and find() in 111ms. Do not reintroduce a
   * "backgrounded WebViews are throttled" explanation without evidence.
   */
  private async guarded<T>(op: string, work: Promise<T>, ms: number): Promise<T> {
    const TIMEOUT = Symbol('cdp-timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });

    try {
      const result = await Promise.race([work, deadline]);
      if (result !== TIMEOUT) return result as T;
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Report the surrounding state as an observation, not as a cause: what makes
    // a WebView stop answering is not established, and a confident-sounding
    // wrong explanation costs more debugging time than none at all.
    const fg = await this.foregroundApp();
    const where =
      fg === this.appPackage
        ? 'app was in the foreground'
        : `foreground app was ${fg ?? 'unknown'}, not ${this.appPackage}`;
    throw new Error(`[cdp] ${op} did not answer within ${ms}ms (${where})`);
  }

  /**
   * Package name of the currently resumed activity, or null when it cannot be
   * determined. Only called on the failure path — one `adb shell` costs ~200ms,
   * which would be ruinous if it ran before every find().
   */
  private async foregroundApp(): Promise<string | null> {
    const serialFlag = this.deviceSerial ? `-s ${this.deviceSerial} ` : '';
    const { stdout } = await exec(
      `adb ${serialFlag}shell dumpsys activity activities | grep -m1 mResumedActivity`,
    ).catch(() => ({ stdout: '' }));
    return stdout.match(/\s([\w.]+)\/[\w.$]+/)?.[1] ?? null;
  }

  /**
   * Reports a CDP timeout once per outage rather than once per attempt: the
   * resolver retries a failing locator hundreds of times, and the diagnosis is
   * the same every time.
   */
  private reportStall(err: unknown): void {
    if (this.stallReported) return;
    this.stallReported = true;
    console.warn((err as Error).message);
  }

  // ── Core operations ─────────────────────────────────────────────────────────

  /**
   * Find an element via CSS/XPath derived from a LocatorCandidate.
   * Returns null (not found) on failure — never throws.
   */
  /**
   * Whether any of the first few matches is actually rendered.
   *
   * Capped: find() already pays a probe per match, and an unbounded scan on a
   * page with hundreds of matches turns one polling tick into the whole resolve
   * budget — a lesson this file has learned once already.
   */
  private async anyVisible(locator: Locator, count: number): Promise<boolean> {
    const limit = Math.min(count, 10);
    for (let i = 0; i < limit; i++) {
      if (await locator.nth(i).isVisible().catch(() => false)) return true;
    }
    return false;
  }

  async find(candidate: LocatorCandidate): Promise<WebViewCdpHandle | null> {
    if (!this.page) return null;
    // A dialog may appear between two scenario steps. Clear only explicitly
    // dismissible top layers before looking for the requested page element —
    // and never the layer that element is itself part of.
    await this.popupInterceptor
      .clear(this.page, protectedSelectors([candidate]))
      .catch(() => {});
    // When the resolver has set a runtimeScope, chain the locator inside that
    // ancestor so inactive Ionic pages are never matched.
    const root = candidate.runtimeScope
      ? this.page.locator(candidate.runtimeScope)
      : this.page;
    let selector = candidate.strategy === 'relative' ? candidate.value : domSelector(candidate);
    let locator = candidate.strategy === 'relative'
      ? toRelativePlaywrightLocator(root, candidate)
      : root.locator(selector);
    try {
      let count = await this.guarded('find', locator.count(), 5000);
      this.stallReported = false;
      // Nothing *visible* — not merely nothing at all. The exact arms kept
      // matching a hidden node left over from another Ionic page, so count was
      // never 0 and the looser pass below never ran: a toast standing plainly on
      // screen went unfound while find() returned a handle to something the
      // user cannot see. Visibility, not existence, is what makes a match
      // usable; an off-screen-but-rendered element still counts, so scrolling
      // to something below the fold is unaffected.
      if (count > 0 && !(await this.anyVisible(locator, count))) count = 0;
      if (count === 0) {
        // Nothing matched the wording exactly. Two further passes now run, in
        // order of how much each gives up, and each is tried in turn — the
        // first that produces an xpath does not get to consume the attempt.
        //
        // A caption the template split across children comes first: the phrase
        // must still appear in full, in the smallest element that holds it, so
        // it is stricter than anything loose. Then the loose reading, where the
        // phrase a scenario writes is only part of a message that states its
        // data inside itself — see labelContainsXPath for why that is a
        // separate, later pass rather than one more arm in the union.
        // The exact arm is index 0 and has just been tried, so the fallbacks
        // are the rest of the same list `inspectMatches` reads.
        const arms = this.selectorsFor(candidate).slice(1);
        if (arms.length === 0) return null;

        let matched = false;
        for (const xpath of arms) {
          // The handle re-derives its own locator from `selector` every time it
          // is asked anything, so the switch has to be recorded here too.
          // Changing only the local locator returned a handle that looked up the
          // *exact* selector again: find() reported success while isVisible()
          // went back to the hidden node and answered false, forever.
          selector = xpath;
          locator = root.locator(selector);
          count = await this.guarded('find-fallback', locator.count(), 5000);
          if (count > 0) { matched = true; break; }
        }
        if (!matched) return null;
      }
      // When multiple elements share the same label/text (e.g. a hidden side-menu
      // item and a visible tab bar entry), prefer whichever is inside the viewport
      // so clicks land on the element the user can actually see.
      let directLocator: Locator | undefined =
        candidate.strategy === 'relative' ? locator : undefined;
      if (count > 1 && candidate.strategy !== 'relative') {
        // Check the first DOM match before iterating: it is usually the right
        // one, and then nothing else has to be asked about.
        if (!(await isHittable(locator.first()))) {
          for (let i = 1; i < count; i++) {
            const nth = locator.nth(i);
            if (await isHittable(nth)) {
              directLocator = nth;
              break;
            }
          }
        }
      }
      return new WebViewCdpHandle(
        candidate,
        this.page,
        selector,
        candidate.runtimeScope,
        directLocator,
      );
    } catch (err) {
      if (isCdpSessionLost(err)) {
        await this.reconnect().catch(() => {});
      } else if ((err as Error).message?.startsWith('[cdp] find did not answer')) {
        // Not "element absent" — the WebView is not answering. Say so once,
        // otherwise the real cause is buried under hundreds of silent nulls.
        this.reportStall(err);
      }
      return null;
    }
  }

  /**
   * Every selector this driver would try for a candidate, cheapest first.
   *
   * Shared by `find` and `inspectMatches` because they disagreed: `find`
   * located "Tiền chuyển (Phí = 0)" through the split-caption arm while
   * `inspectMatches` rebuilt the plain exact selector, which matches nothing —
   * so the element resolved, the step ran, and the assertion compared against
   * an empty string. A resolution read back through a different locator is not
   * the same resolution. The Playwright driver learned this first; keeping the
   * order in one method is what stops the two drivers relearning it separately.
   */
  private selectorsFor(candidate: LocatorCandidate): string[] {
    const exact = candidate.strategy === 'relative' ? candidate.value : domSelector(candidate);
    if (candidate.strategy !== 'label') return [exact];
    // A caption the template split across children stays exact — the phrase
    // must appear in full — so it comes before the loose reading, where the
    // phrase is only part of a longer message.
    const fallbacks = [
      labelSplitAcrossChildrenXPath(candidate.value),
      labelContainsXPath(candidate.value),
    ].filter((xpath): xpath is string => Boolean(xpath));
    return [exact, ...fallbacks.map((xpath) => `xpath=${xpath}`)];
  }

  async inspectMatches(candidate: LocatorCandidate): Promise<UiMatchSnapshot> {
    if (!this.page) return { count: 0, texts: [], focused: [] };
    await this.popupInterceptor.clear(this.page, protectedSelectors([candidate])).catch(() => {});
    const root = candidate.runtimeScope ? this.page.locator(candidate.runtimeScope) : this.page;
    // Same order as `find`, and the first arm that sees a visible node wins —
    // an earlier arm matching nothing must not be reported as "no text".
    let locator = candidate.strategy === 'relative'
      ? toRelativePlaywrightLocator(root, candidate)
      : root.locator(this.selectorsFor(candidate)[0]!);
    if (candidate.strategy !== 'relative') {
      for (const selector of this.selectorsFor(candidate)) {
        const arm = root.locator(selector);
        const count = await arm.count().catch(() => 0);
        if (count > 0 && (await this.anyVisible(arm, count))) { locator = arm; break; }
      }
    }
    return this.guarded('inspectMatches', locator.evaluateAll((nodes) => {
      const visible = nodes.filter((node) => {
        const el = node as HTMLElement;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      return {
        count: visible.length,
        texts: visible.map((node) => ((node as HTMLElement).innerText ?? node.textContent ?? '').replace(/\s+/g, ' ').trim()),
        focused: visible.flatMap((node, index) => {
          const el = node as HTMLElement;
          const selected = el.matches(':focus, [aria-selected="true"], [aria-current="true"], [aria-checked="true"], .focused, .selected, .active');
          return selected ? [index] : [];
        }),
      };
    }), 5_000);
  }

  /**
   * Picks a value from a dropdown, whichever kind of dropdown it is.
   *
   * A real `<select>` can be set in one call. Everything Angular Material,
   * Ionic or Capacitor renders is not a `<select>` at all — it is a div that
   * opens a floating list — and `selectOption()` on one of those throws
   * "Element is not a <select> element". Since a scenario author has no reason
   * to know which kind they are looking at, the step accepts both and this
   * decides: ask the element what it is, then either set it or open it and
   * click the option.
   */
  /**
   * The same caption-to-value read the Playwright driver does.
   *
   * Missing here until now, and the gap was invisible: `readTexts` skips the
   * whole fallback when the driver cannot do it, so `remember "Được chuyển"`
   * quietly stored the caption instead of the balance and the assertion that
   * followed compared words with a number.
   */
  async captionValue(handle: WebViewCdpHandle): Promise<string | undefined> {
    const locator = handle.locator();
    const caption = (await locator.innerText({ timeout: 1000 }).catch(() => '')) ?? '';
    return locator.evaluate(valueBesideCaption, caption).catch((err: Error) => {
      console.log(`[a11y] không đọc được giá trị cạnh nhãn "${caption.trim()}": ${err.message.split('\n')[0]}`);
      return undefined;
    });
  }

  async listOptions(handle: WebViewCdpHandle): Promise<string[] | undefined> {
    const page = handle.page;
    const expanded = await handle
      .locator()
      .evaluate((node) => (node as Element).getAttribute('aria-expanded'))
      .catch(() => null);
    if (expanded !== 'true') {
      // Opened here rather than left to the scenario: a closed dropdown reads
      // as zero choices, and "not among the choices" would then pass having
      // checked nothing.
      await this.popupInterceptor.clear(page, await keep(handle)).catch(() => {});
      await handle.locator().click({ timeout: 5000 });
    }
    // The list animates in, so the first look is too early. Poll rather than
    // sleep: a fast device should not pay for a slow one.
    // Waited until the list stops growing, not until it first has anything in
    // it. A Material panel renders its options progressively, so the first
    // non-empty reading can be a partial list — and a partial list is exactly
    // how "this value is not among the choices" passes while the value is in
    // fact there, further down. That false pass has already happened once: the
    // same assertion went green on one run and red on the next, against an app
    // that behaved identically both times.
    const deadline = Date.now() + 5_000;
    let seen: string[] = [];
    let previous = -1;
    while (Date.now() < deadline) {
      const now = await page.evaluate(openOptionLabels).catch(() => []);
      if (now.length > 0 && now.length === previous) return now;
      previous = now.length;
      seen = now;
      await sleep(200);
    }
    // Empty after opening and waiting is a real answer for a dropdown with no
    // choices; `undefined` is reserved for "this driver cannot tell".
    return seen;
  }

  async selectOption(handle: WebViewCdpHandle, option: string): Promise<void> {
    const locator = handle.locator();
    const tag = await locator
      .evaluate((node) => (node as Element).tagName.toLowerCase())
      .catch(() => '');

    if (tag === 'select') {
      await locator.selectOption({ label: option });
      return;
    }

    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    await locator.click({ timeout: 5000 });

    // The list animates in, so the option is not there on the first look. Poll
    // rather than sleep: a fast device should not pay for a slow one.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const opt = await this.findOption(handle.page, option);
      if (opt && (await isHittable(opt))) {
        await opt.click({ timeout: 5_000 });
        return;
      }
      const found = await this.find({
        strategy: 'label', value: option, weight: 1, origin: 'authored',
      });
      if (found && (await isHittable(found.locator()))) {
        await this.tap(found);
        return;
      }
      await sleep(200);
    }
    throw new Error(
      `Mở "${handle.candidate.value}" rồi nhưng không thấy lựa chọn "${option}" nào bấm được.`,
    );
  }

  /**
   * Find one entry of an open dropdown by its visible label.
   *
   * Options carry more than their label — Material puts the description in the
   * same node — so exact whole-text matching misses. Prefer the inner label
   * node, then fall back to a prefix of the whole text. Case and spacing are
   * ignored: the scenario says what the user reads, not how the app capitalises
   * it ("Ký quỹ" must find "Ký Quỹ").
   */
  private async findOption(page: Page, option: string): Promise<Locator | null> {
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
    const want = norm(option);
    if (!want) return null;

    const options = page.locator('[role="option"], mat-option, li[role="menuitem"]');
    const total = await options.count().catch(() => 0);
    const texts: string[][] = [];
    for (let i = 0; i < total; i += 1) {
      const pair = await options
        .nth(i)
        .evaluate((node) => {
          const el = node as Element;
          const label = el.querySelector('label');
          return [label?.textContent ?? '', el.textContent ?? ''];
        })
        .catch(() => ['', '']);
      texts.push(pair as string[]);
    }

    for (let i = 0; i < texts.length; i += 1) {
      if (norm(texts[i]?.[0] ?? '') === want) return options.nth(i);
    }
    for (let i = 0; i < texts.length; i += 1) {
      if (norm(texts[i]?.[1] ?? '') === want) return options.nth(i);
    }
    for (let i = 0; i < texts.length; i += 1) {
      if (norm(texts[i]?.[1] ?? '').startsWith(want)) return options.nth(i);
    }
    return null;
  }

  /** Click/tap an element. */
  async tap(handle: WebViewCdpHandle): Promise<void> {
    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    const root = handle.locator();
    const tooltipTrigger = root.locator('[apppopuphover],[tcbstooltip]').first();
    const locator = await tooltipTrigger.isVisible({ timeout: 200 }).catch(() => false)
      ? tooltipTrigger
      : root;
    try {
      await locator.click({ timeout: 5000 });
    } catch (err) {
      const dismissed = await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => 0);
      if (dismissed > 0) {
        await locator.click({ timeout: 5000 });
        return;
      }
      if (await this.clickAnotherMatch(handle)) return;
      throw err;
    }
  }

  /**
   * Clicks a different element matching the same locator.
   *
   * A label can belong to several nodes — a drawer item and the visible tab
   * both read "Trái phiếu" — and only one of them can be clicked. find() picks
   * the hittable one, but that judgement is made before the click and can be
   * wrong: the page moves, or the geometry is subtler than any predicate here.
   * So the last word belongs to Playwright's own actionability check, which is
   * the thing that rejected the first candidate in the first place. Whichever
   * twin accepts a click is the one the step meant.
   *
   * Only reached after a click has already failed, so the extra probes cost
   * nothing on a passing run.
   */
  private async clickAnotherMatch(handle: WebViewCdpHandle): Promise<boolean> {
    // A relative locator is an expression, not a selector that can be re-run.
    if (handle.candidate.strategy === 'relative' || !handle.selector) return false;

    const root = handle.scope ? handle.page.locator(handle.scope) : handle.page;
    const all = root.locator(handle.selector);
    // Guarded like every other CDP call here; an unbounded count() hangs the run.
    const count = await this.guarded('clickAnotherMatch', all.count(), 3000).catch(() => 0);
    if (count < 2) return false;

    for (let i = 1; i < count; i++) {
      const nth = all.nth(i);
      // Gate on hittability first. Playwright will happily scroll a twin that
      // sits below the fold into view and click it, which succeeds and is
      // wrong: the step meant the control the user can see, not an identically
      // labelled row further down the page.
      if (!(await isHittable(nth))) continue;
      try {
        await nth.click({ timeout: 1500 });
        return true;
      } catch {
        // Hittable a moment ago but not clickable now; try the next.
      }
    }
    return false;
  }

  /**
   * Scrolls the WebView page by most of a screen.
   *
   * Returns false when there is no live page, so the caller can fall back to a
   * native fling instead of silently doing nothing.
   */
  async scrollPage(direction: 'up' | 'down'): Promise<boolean> {
    if (!this.page) return false;
    await this.page.evaluate(
      (sign: number) =>
        window.scrollBy({ top: sign * window.innerHeight * 0.8, behavior: 'instant' }),
      direction === 'down' ? 1 : -1,
    );
    return true;
  }

  /**
   * Press and hold on the element.
   *
   * Driven through the mouse rather than a Playwright action, because there is
   * no locator-level "hold for N ms" — and the native `mobile: longClickGesture`
   * cannot be used here at all: it addresses a native element id, which a DOM
   * node does not have.
   */
  async longPress(handle: WebViewCdpHandle, ms: number): Promise<void> {
    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    const locator = handle.locator();
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await locator.boundingBox({ timeout: 5000 });
    if (!box) throw new Error('Không nhấn giữ được: element không có vị trí trên màn hình.');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await handle.page.mouse.move(x, y);
    await handle.page.mouse.down();
    await sleep(ms);
    await handle.page.mouse.up();
  }

  /**
   * Brings the element into view inside the WebView.
   *
   * Playwright scrolls the nearest scrollable ancestor, which is what a page
   * inside a WebView needs — a native fling would be swallowed by the WebView
   * or turned into a pull-to-refresh.
   */
  async scrollIntoView(handle: WebViewCdpHandle): Promise<void> {
    await handle.locator().scrollIntoViewIfNeeded({ timeout: 5000 });
  }

  async hover(handle: WebViewCdpHandle): Promise<void> {
    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    await handle.locator().hover({ timeout: 5_000 });
  }

  async dragDrop(source: WebViewCdpHandle, target: WebViewCdpHandle): Promise<void> {
    await this.popupInterceptor.clear(source.page, await keep(source)).catch(() => {});
    await source.locator().dragTo(target.locator(), { timeout: 8_000 });
  }

  /**
   * Angular-aware fill: tries page.fill() first, then falls back to the native
   * HTMLInputElement value setter + dispatching input/change/keyup events.
   * The native-setter path is necessary because Angular's reactive forms listen
   * for those events and ignore value assignments that go through the DOM directly.
   */
  async fill(handle: WebViewCdpHandle, text: string, typeDelay?: number): Promise<void> {
    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    const locator = handle.locator();

    // When typeDelay is set, type character-by-character so autocomplete/search
    // APIs receive individual input events rather than the full value at once.
    if (typeDelay) {
      await locator.clear({ timeout: 3000 }).catch(() => {});
      await locator.pressSequentially(text, { delay: typeDelay });
      await sleep(500);
      return;
    }

    // 1. Standard fill
    try {
      await locator.fill(text, { timeout: 3000 });
      const val = await locator.inputValue({ timeout: 1000 }).catch(() => null);
      if (val !== text) throw new Error('value mismatch after fill');
    } catch {
      // 2. Angular-aware native setter
      const outcome = await handle.page.evaluate(
        ({ selector, value }: { selector: string; value: string }) => {
          // Inlined on purpose. esbuild's keepNames wraps any *named* function
          // in a __name() call, and this body is serialised into the page —
          // where that helper does not exist, so the whole fallback died with
          // "ReferenceError: __name is not defined" instead of typing.
          const el = (selector.startsWith('/')
            ? document.evaluate(
                selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null,
              ).singleNodeValue
            : document.querySelector(selector)) as HTMLElement | null;
          if (!el) return 'missing';
          const inputEl = el as HTMLInputElement;
          // The setter has to come from the element's own prototype. Borrowing
          // HTMLInputElement's and calling it on anything else — a textarea, a
          // wrapper div that a `[name=...]` lookup landed on — throws "Illegal
          // invocation", which surfaces as a TypeError from page.evaluate and
          // says nothing about which field or why.
          const proto =
            inputEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
            : inputEl instanceof HTMLInputElement ? HTMLInputElement.prototype
            : null;
          const nativeSetter = proto
            ? Object.getOwnPropertyDescriptor(proto, 'value')?.set
            : undefined;
          if (nativeSetter) nativeSetter.call(inputEl, value);
          else if ('value' in inputEl) inputEl.value = value;
          else if ((el as HTMLElement).isContentEditable) (el as HTMLElement).textContent = value;
          // Nothing that can hold a value. Say so — the caller turns this into
          // a failed step. Returning quietly here made the step pass while the
          // field stayed empty: the read-back check cannot save it either,
          // because a non-field reads back as null and is skipped by design.
          else return 'not-a-field';
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', bubbles: true }));
          return 'ok';
        },
        { selector: handle.selector, value: text },
      );
      if (outcome === 'not-a-field') {
        throw new Error(
          `"${handle.candidate.value}" khớp vào một phần tử không nhập được chữ ` +
            `(${handle.selector}). Nhãn thường trỏ vào <label>/<legend> chứ không vào ô nhập; ` +
            'element này cần locator riêng, ví dụ css=input[name="..."].',
        );
      }
      if (outcome === 'missing') {
        throw new Error(`Không còn thấy "${handle.candidate.value}" trong trang khi gõ.`);
      }
    }
    // Allow Angular reactive forms and debounced API calls (search autocomplete)
    // to settle before the next action fires.
    await sleep(500);
  }

  async selectDate(handle: WebViewCdpHandle, date: string): Promise<void> {
    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    await selectDateWithPlaywright(handle.locator(), date);
  }

  /** Clear a field. */
  async clear(handle: WebViewCdpHandle): Promise<void> {
    await this.popupInterceptor.clear(handle.page, await keep(handle)).catch(() => {});
    const locator = handle.locator();
    try {
      await locator.fill('', { timeout: 3000 });
      return;
    } catch {
      // Fall through to native setter
    }

    await handle.page.evaluate(
      (selector: string) => {
        // Named functions cannot survive the trip into the page; see type().
        const el = (selector.startsWith('/')
          ? document.evaluate(
              selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null,
            ).singleNodeValue
          : document.querySelector(selector)) as HTMLElement | null;
        if (!el) return;
        const inputEl = el as HTMLInputElement;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value',
        )?.set;
        if (nativeSetter) nativeSetter.call(inputEl, '');
        else inputEl.value = '';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      },
      handle.selector,
    );
  }

  // ── Observation ──────────────────────────────────────────────────────────────

  /**
   * Scrape the live DOM into a UiObservation.
   *
   * Targets input, textarea, button, [role=button], a, select — the elements a
   * test scenario will need to interact with. For each element the following
   * Angular/HTML5 attributes are extracted:
   *   - formcontrolname → resourceId (stable Angular form field identity)
   *   - data-testid / data-test / data-cy → testId
   *   - aria-label → accessibilityLabel
   *   - id → fallback resourceId
   *   - placeholder, value → as named
   *   - innerText → text (for buttons/links)
   *   - getBoundingClientRect → visible + bounds
   */
  async observe(): Promise<UiObservation> {
    if (!this.page) throw new Error('[cdp] WebViewCdpDriver not connected');

    type RawEl = {
      tag: string;
      placeholder?: string;
      value?: string;
      ariaLabel?: string;
      testId?: string;
      name?: string;
      id?: string;
      formcontrolname?: string;
      /**
       * Raw DOM text, whitespace-collapsed. Deliberately textContent, NOT
       * innerText: innerText returns the *rendered* string and therefore honours
       * `text-transform: uppercase`, while XPath's normalize-space(string(.))
       * matches against the untransformed DOM text. Harvesting innerText made
       * healing emit `label=ĐĂNG NHẬP` for a button whose DOM text is
       * `Đăng nhập` — a locator that could never match.
       */
      domText?: string;
      // Stable CSS classes (excluding Angular internal classes like ng-*, mat-*)
      cssClasses?: string;
      /** Stable selector for custom controls such as tcbs-icon[name]. */
      css?: string;
      customName?: string;
      disabled: boolean;
      visible: boolean;
      rect: { x: number; y: number; width: number; height: number };
    };

    // 10s: a full DOM scrape on a large Angular page is legitimately slower than
    // a single locator lookup, but still nowhere near a hang.
    const raw: RawEl[] = await this.guarded('observe', this.page.evaluate(() => {
      const nodes = document.querySelectorAll(
        // `label` and `legend` earn their place: they are where a form keeps the
        // words a person reads to identify a field, and without them the
        // observation showed `name="volume"` with no hint that the screen calls
        // it "KL đặt". Both the scorer and the AI tier were guessing from
        // English attribute names because the caption was never observed.
        'input, textarea, button, [role], a, select, [onclick], tcbs-icon[name], ' +
          'span, p, li, label, legend',
      );
      return Array.from(nodes).map((node) => {
        const el = node as HTMLElement & { disabled?: boolean; value?: string; placeholder?: string; type?: string };
        const rect = el.getBoundingClientRect();

        // Extract stable CSS classes: skip Angular/CDK internal class prefixes
        const stableClasses = Array.from(el.classList)
          .filter((c) => !c.startsWith('ng-') && !c.startsWith('mat-') && !c.startsWith('cdk-') && !c.startsWith('_'))
          .join(' ')
          .trim() || undefined;

        const customName = el.tagName.includes('-')
          ? el.getAttribute('name') || undefined
          : undefined;
        let css: string | undefined;
        if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
          css = `#${CSS.escape(el.id)}`;
        } else if (customName) {
          const escaped = customName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const byName = `${el.tagName.toLowerCase()}[name="${escaped}"]`;
          if (document.querySelectorAll(byName).length === 1) css = byName;
        }

        return {
          tag: el.tagName.toLowerCase(),
          placeholder: el.placeholder || undefined,
          value: el.value || undefined,
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('title') || customName || undefined,
          testId:
            el.getAttribute('data-testid') ||
            el.getAttribute('data-test') ||
            el.getAttribute('data-cy') ||
            undefined,
          id: el.id || undefined,
          name: el.getAttribute('name') || undefined,
          formcontrolname: el.getAttribute('formcontrolname') || undefined,
          // Collapse whitespace runs exactly as XPath normalize-space() does, so
          // the harvested string is byte-identical to what the selector matches.
          domText: (el.textContent ?? '').replace(/\s+/g, ' ').trim() || undefined,
          cssClasses: stableClasses,
          css,
          customName,
          disabled: el.disabled === true,
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      });
    }), 10000);
    this.stallReported = false;

    const elements: ObservedElement[] = raw.map((el, i) => {
      // Build CSS locator candidates from stable classes + tag (e.g. "button.btn-login")
      // These become `css` strategy candidates during healing, which are far more
      // stable than text-based XPath for Angular Material components.
      const cssCandidates: string[] = el.css ? [el.css] : [];
      if (el.cssClasses) {
        const classSelectors = el.cssClasses
          .split(/\s+/)
          .filter(Boolean)
          .map((c) => `.${c}`);
        if (classSelectors.length > 0) {
          // Tag + all classes is the most specific, least ambiguous selector
          cssCandidates.push(`${el.tag}${classSelectors.join('')}`);
          // Tag + first class alone as fallback
          if (classSelectors.length > 1) cssCandidates.push(`${el.tag}${classSelectors[0]}`);
        }
      }

      return {
        id: `cdp-el-${i}`,
        role: el.customName ? 'button' : el.tag,
        text: el.domText || el.value,
        accessibilityLabel: el.ariaLabel,
        testId: el.testId,
        placeholder: el.placeholder,
        // Identity, most stable first. `name` sits between the two because a
        // form control keeps it across renders, while Angular Material hands
        // out `mat-input-0`, `mat-select-14` and renumbers them every time the
        // view is rebuilt — an id like that is not identity, it is a counter,
        // and healing that emitted one produced a locator dead on arrival.
        resourceId: el.formcontrolname || el.name || (isGeneratedId(el.id) ? undefined : el.id),
        value: el.value,
        visible: el.visible,
        enabled: !el.disabled,
        interactive: true,
        bounds: el.visible ? el.rect : undefined,
        // css: most specific stable class-based selector — used by healing to
        // generate a `css` strategy candidate instead of fragile text XPath.
        css: cssCandidates[0],
      };
    });

    return {
      id: `obs-cdp-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      platform: 'web',
      source: 'webview',
      context: {
        appPackage: this.appPackage,
        deviceId: this.deviceSerial,
      },
      elements,
    };
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  /**
   * Dismiss in-page overlay dialogs (Material dialogs, CDK overlays) that are
   * blocking the UI. Called by the resolver's poll loop when all candidates fail,
   * so the next tick runs on a clean screen without explicit feature steps.
   *
   * Returns true when something was dismissed so the resolver retries immediately.
   */
  async dismissOverlay(protect: string[] = []): Promise<boolean> {
    if (!this.page) return false;
    return Boolean(await this.popupInterceptor.dismissOne(this.page, protect));
  }

    /** True when document.readyState === 'complete'. */
  async isIdle(): Promise<boolean> {
    if (!this.page) return true;
    try {
      const state = await this.guarded(
        'isIdle',
        this.page.evaluate(() => document.readyState),
        3000,
      );
      this.stallReported = false;
      return state === 'complete';
    } catch (err) {
      // Returning true keeps the resolver from waiting on a driver that cannot
      // answer — but an unresponsive WebView is worth saying out loud, since
      // "not idle" and "not answering" lead to very different fixes.
      this.reportStall(err);
      return true;
    }
  }

  async currentUrl(): Promise<string> {
    if (!this.page) return '';
    return this.guarded(
      'currentUrl',
      this.page.evaluate(() => window.location.pathname + window.location.hash),
      2000,
    ).catch(() => '');
  }

  /** Write DOM HTML to a file for debugging. Returns the file path, or undefined on error. */
  async dumpDom(name: string, outDir: string): Promise<string | undefined> {
    if (!this.page) return undefined;
    try {
      await mkdir(outDir, { recursive: true });
      const html = await this.guarded('dumpDom', this.page.content(), 10000);
      const safeName = name.replace(/[^a-z0-9-_]+/gi, '_');
      const file = path.join(outDir, `${safeName}.dom.html`);
      await writeFile(file, html, 'utf8');
      return file;
    } catch {
      return undefined;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when a CDP error indicates the target page/context is gone.
 * Used by NativeUiDriver to decide whether to reconnect vs. just fall through.
 */
export function isCdpSessionLost(err: unknown): boolean {
  const m = String((err as Error)?.message ?? '').toLowerCase();
  return (
    m.includes('target closed') ||
    m.includes('session closed') ||
    m.includes('no target')
  );
}
