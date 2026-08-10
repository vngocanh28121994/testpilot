import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  chromium,
  devices,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import type { Observed } from '../crawl/observe.js';
import type { LocatorCandidate, Platform } from '../core/types.js';
import type { UiDriver, UiHandle } from './driver.js';

/**
 * What the page under test is allowed to talk to.
 *
 * This exists because a build can have its backend compiled in. TCInvest's
 * bundled web app hardcodes `apiext.tcbs.com.vn` — production — so without a
 * policy here, a login test would throw real credentials at a real trading
 * backend and could lock a real account after five tries. Blocking by default
 * makes that impossible rather than merely unlikely.
 */
export interface NetworkPolicy {
  /** Host substitutions, applied before the allowlist: production -> SIT. */
  rewrite?: Array<{ from: string; to: string }>;
  /** Extra hosts the page may reach. Its own origin is always allowed. */
  allow?: string[];
  /** Everything that matched nothing above. */
  fallback?: 'block' | 'allow';
}

export interface WebDriverOptions {
  baseUrl: string;
  headless?: boolean;
  device?: string;
  artifactsDir: string;
  /** Record a trace + video; strongly recommended, the flake report links to them. */
  record?: boolean;
  /** Omitted means no interception at all — the page reaches whatever it wants. */
  network?: NetworkPolicy;
  /**
   * Delay between Playwright actions. Only useful with headless off: at full
   * speed a headed run is a blur, which defeats the point of watching it.
   */
  slowMoMs?: number;
}

class WebHandle implements UiHandle {
  constructor(
    readonly candidate: LocatorCandidate,
    readonly locator: Locator,
  ) {}

  async isVisible(): Promise<boolean> {
    return this.locator.isVisible();
  }

  async text(): Promise<string> {
    return (await this.locator.innerText()).trim();
  }

  /** null for anything that is not an input/textarea/select — inputValue throws there. */
  async value(): Promise<string | null> {
    return this.locator.inputValue().catch(() => null);
  }
}

export class WebUiDriver implements UiDriver {
  readonly platform: Platform = 'web';
  readonly device: string;

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  /** Hosts already warned about, so one blocked poller does not flood the log. */
  private readonly blocked = new Set<string>();

  constructor(private readonly opts: WebDriverOptions) {
    this.device = opts.device ?? 'chromium-desktop';
  }

  private get p(): Page {
    if (!this.page) throw new Error('WebUiDriver.start() was not called.');
    return this.page;
  }

  async start(): Promise<void> {
    await mkdir(this.opts.artifactsDir, { recursive: true });
    this.browser = await chromium.launch({
      headless: this.opts.headless ?? true,
      ...(this.opts.slowMoMs ? { slowMo: this.opts.slowMoMs } : {}),
    });
    this.context = await this.browser.newContext({
      ...emulation(this.device),
      ...(this.opts.record
        ? { recordVideo: { dir: path.join(this.opts.artifactsDir, 'video') } }
        : {}),
    });
    if (this.opts.network) await this.installNetworkPolicy(this.context, this.opts.network);
    this.page = await this.context.newPage();
  }

  /**
   * Rewrite first, then allow/block. Blocked hosts are reported once each: a
   * test that silently receives no data is far harder to diagnose than one that
   * says which call it refused to make.
   */
  private async installNetworkPolicy(context: BrowserContext, policy: NetworkPolicy) {
    const ownHost = safeHost(this.opts.baseUrl);
    const allow = new Set([ownHost, ...(policy.allow ?? [])].filter(Boolean));
    const fallback = policy.fallback ?? 'block';

    await context.route('**', async (route) => {
      const original = new URL(route.request().url());

      // Data/blob URLs never leave the browser.
      if (original.protocol === 'data:' || original.protocol === 'blob:') return route.continue();

      const rule = (policy.rewrite ?? []).find((r) => original.hostname === r.from);
      const host = rule ? rule.to : original.hostname;

      if (allow.has(host) || fallback === 'allow') {
        if (!rule) return route.continue();
        const rewritten = new URL(original.toString());
        rewritten.hostname = rule.to;
        return route.continue({ url: rewritten.toString() });
      }

      if (!this.blocked.has(host)) {
        this.blocked.add(host);
        console.warn(`[web] chặn request ra ${host} (không có trong network.allow)`);
      }
      return route.abort('blockedbyclient');
    });
  }

  async stop(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  /**
   * Playwright ties a video to a page, and only finalises it once that page
   * closes. One page for the whole run therefore yields one long recording
   * that is nearly useless for diagnosing a specific scenario, so each
   * scenario gets a fresh page.
   */
  async beginScenario(_scenarioId: string): Promise<void> {
    if (!this.opts.record || !this.context) return;
    if (this.page) {
      // The page from start() belongs to no scenario; drop its recording rather
      // than leaving a `page@<hash>.webm` nobody can trace back to a test.
      const orphan = this.page.video();
      await this.page.close();
      await orphan?.delete().catch(() => {});
    }
    this.page = await this.context.newPage();
  }

  /** Closes the page so the video is flushed, then names it after the scenario. */
  async endScenario(scenarioId: string): Promise<string | undefined> {
    if (!this.opts.record || !this.page) return undefined;
    const video = this.page.video();
    if (!video) return undefined;

    await this.page.close(); // must close before the file exists on disk
    const target = path.join(this.opts.artifactsDir, 'video', `${sanitize(scenarioId)}.webm`);
    try {
      await video.saveAs(target);
      await video.delete().catch(() => {});
    } catch {
      // A crashed page can leave no recording. Losing the video must not turn
      // a reported test result into an unreported crash.
      return undefined;
    }
    return target;
  }

  async launch(target?: string): Promise<void> {
    await this.p.goto(target ?? this.opts.baseUrl, { waitUntil: 'domcontentloaded' });
  }

  async find(c: LocatorCandidate): Promise<UiHandle | null> {
    const locator = this.toLocator(c);
    // .first() keeps a duplicated match from becoming a strict-mode crash; the
    // ambiguity is instead reported as a low-quality locator in the heal report.
    const first = locator.first();
    if ((await first.count()) === 0) return null;
    return new WebHandle(c, first);
  }

  private toLocator(c: LocatorCandidate): Locator {
    switch (c.strategy) {
      case 'testId':
        return this.p.getByTestId(c.value);
      case 'role':
        return this.p.getByRole(c.value as Parameters<Page['getByRole']>[0], {
          ...(c.name ? { name: c.name } : {}),
        });
      case 'label':
        // Try the accessible label first, fall back to visible text.
        return this.p.getByLabel(c.value).or(this.p.getByText(c.value, { exact: false }));
      case 'placeholder':
        return this.p.getByPlaceholder(c.value);
      case 'css':
        return this.p.locator(c.value);
      case 'xpath':
        return this.p.locator(`xpath=${c.value}`);
      case 'predicate':
        throw new Error('The "predicate" strategy is iOS-only and has no web equivalent.');
    }
  }

  async tap(h: UiHandle): Promise<void> {
    await (h as WebHandle).locator.click();
  }

  async longPress(h: UiHandle, ms: number): Promise<void> {
    await (h as WebHandle).locator.click({ delay: ms });
  }

  async input(h: UiHandle, text: string): Promise<void> {
    await (h as WebHandle).locator.fill(text);
  }

  async clear(h: UiHandle): Promise<void> {
    await (h as WebHandle).locator.fill('');
  }

  async selectOption(h: UiHandle, option: string): Promise<void> {
    await (h as WebHandle).locator.selectOption({ label: option });
  }

  async scrollIntoView(h: UiHandle): Promise<void> {
    await (h as WebHandle).locator.scrollIntoViewIfNeeded();
  }

  async swipe(direction: 'left' | 'right' | 'up' | 'down'): Promise<void> {
    const delta = 400;
    const map = {
      left: [-delta, 0],
      right: [delta, 0],
      up: [0, -delta],
      down: [0, delta],
    } as const;
    const [dx, dy] = map[direction];
    await this.p.mouse.wheel(dx, dy);
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.swipe(direction);
  }

  async back(): Promise<void> {
    await this.p.goBack();
  }

  async screenshot(name: string): Promise<string> {
    const file = path.join(this.opts.artifactsDir, `${sanitize(name)}.png`);
    await this.p.screenshot({ path: file, fullPage: false });
    return file;
  }

  /**
   * Harvests every addressable element in the DOM.
   *
   * The browser-side code is a string, not a function literal, and that is not
   * a style choice: tsx compiles this file with esbuild's `keepNames`, which
   * rewrites named inner functions to call a `__name` helper. Playwright
   * serialises the callback and ships it to a page where that helper does not
   * exist, so a normal closure dies with `__name is not defined`. A string
   * crosses the boundary untouched.
   *
   * One evaluate rather than a query per element: a screen has a few dozen
   * candidates and a round trip each would make crawling a real app crawl.
   */
  async observe(): Promise<Observed[]> {
    return this.p.evaluate(OBSERVE_DOM) as Promise<Observed[]>;
  }

  async isIdle(): Promise<boolean> {
    try {
      await this.p.waitForLoadState('networkidle', { timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 120);
}

/** Hostname of a URL, or '' if it is not parseable — never throws at startup. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Turns the configured device name into a Playwright emulation descriptor.
 *
 * Playwright drives a *browser*, never an app — so when the thing under test is
 * a mobile web app, the browser has to be told to behave like a phone. Without
 * this the suite runs at a desktop viewport and simply never sees the layout
 * real users get. `chromium-desktop` opts out and keeps the plain desktop
 * context.
 *
 * These are still emulations running on the host: viewport, user agent, touch
 * and device scale, not real hardware. Driving Chrome on an actual Android
 * device is a separate Playwright API, and AWS Device Farm cannot run
 * Playwright at all — see the constraint table in ARCHITECTURE.md.
 */
function emulation(device: string): Record<string, unknown> {
  if (!device || device === 'chromium-desktop') return {};

  const preset = devices[device];
  if (!preset) {
    const sample = Object.keys(devices).filter((d) => /^Pixel|^iPhone/.test(d)).slice(0, 6);
    throw new Error(
      `web.device "${device}" không có trong danh sách thiết bị của Playwright.\n` +
        `Dùng "chromium-desktop" để tắt emulation, hoặc một tên như: ${sample.join(', ')}.`,
    );
  }
  // The engine is fixed to Chromium here, so drop the descriptor's own choice
  // rather than let a WebKit preset silently do nothing.
  const { defaultBrowserType: _ignored, ...rest } = preset;
  return rest;
}

/**
 * Runs inside the page. Kept as a string so esbuild never touches it — see
 * WebUiDriver.observe. Returns raw observations; ranking happens in
 * crawl/observe.ts, on the Node side, where it can be unit tested.
 */
const OBSERVE_DOM = `(() => {
  var SEL = 'a,button,input,select,textarea,[role],[data-testid],[data-test],[data-cy],' +
            'h1,h2,h3,h4,h5,h6,label,[onclick]';
  var seen = {};

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  }

  function cssFor(el) {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }
    var parts = [], node = el;
    while (node && node !== document.body && parts.length < 4) {
      var tag = node.tagName.toLowerCase();
      var sibs = node.parentElement ? Array.prototype.slice.call(node.parentElement.children) : [];
      var same = sibs.filter(function (x) { return x.tagName === node.tagName; });
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag);
      node = node.parentElement;
    }
    var sel = parts.join(' > ');
    return sel && document.querySelectorAll(sel).length === 1 ? sel : undefined;
  }

  var IMPLICIT = { a: 'link', button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox' };

  return Array.prototype.slice.call(document.querySelectorAll(SEL))
    .filter(visible)
    .map(function (el) {
      var tag = el.tagName.toLowerCase();
      var role = el.getAttribute('role') || IMPLICIT[tag] || tag;
      var n = seen[role] || 0;
      seen[role] = n + 1;
      var text = (el.innerText || '').trim().replace(/\\s+/g, ' ');
      return {
        testId: el.getAttribute('data-testid') || el.getAttribute('data-test') ||
                el.getAttribute('data-cy') || undefined,
        role: role,
        name: el.getAttribute('aria-label') || el.getAttribute('title') || undefined,
        text: text && text.length <= 80 ? text : undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        css: cssFor(el),
        interactive: /^(a|button|input|select|textarea)$/.test(tag) || el.hasAttribute('onclick'),
        index: n,
        container: el.children.length > 0,
      };
    });
})()`;
