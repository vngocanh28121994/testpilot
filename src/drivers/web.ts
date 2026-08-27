import { ROW_CLASS_TOKENS, ROW_SELECTOR } from '../core/rows.js';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { labelContainsXPath, labelSplitAcrossChildrenXPath, labelXPathsBySpelling } from '../core/labelXPath.js';
import {
  chromium,
  devices,
  selectors,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import type { Observed } from '../crawl/observe.js';
import type { LocatorCandidate, Platform } from '../core/types.js';
import {
  protectedSelectors,
  type ControlInspection,
  type UiDriver,
  type UiHandle,
  type UiMatchSnapshot,
} from './driver.js';
import { PopupInterceptor, type PopupRule } from './PopupInterceptor.js';
import { normalizeHumanText } from '../core/text.js';
import { toRelativePlaywrightLocator } from './relativeLocator.js';
import { isHittable } from './viewport.js';
import { PlaywrightMcpObserver } from '../discovery/mcp/PlaywrightMcpObserver.js';
import { selectDateWithPlaywright } from './datePicker.js';
import { inspectPlaywrightControl } from './controlClassifier.js';
import { accessibleNameOf } from './accessibleName.js';
import { valueBesideCaption } from './captionValue.js';
import { openOptionLabels } from './options.js';

/**
 * Where a non-native dropdown puts its options.
 *
 * Angular Material detaches the panel from the control and appends it to the
 * CDK overlay container, so it cannot be found by looking inside the combobox.
 * `role="listbox"` covers the same pattern in other component libraries.
 */
const CUSTOM_OPTION_PANEL =
  '.cdk-overlay-pane, .mat-select-panel, .mat-mdc-select-panel, [role="listbox"]';
const CUSTOM_OPTION = '[role="option"], mat-option, .mat-option, .mat-mdc-option';

/**
 * Find an element by the text a person actually reads on it.
 *
 * XPath can ask for a node's own text, or for everything underneath it, and
 * neither is what a label is. `Tiền chuyển (Phí = 0)` is rendered as two spans
 * because Angular interpolates the fee into its own node, so no single node
 * owns the whole string; and the div that does own it also contains a tooltip,
 * so its concatenated text is the label plus a paragraph of explanation. Both
 * XPath arms miss, each for a different reason, and the element resolves as
 * absent while sitting in plain view.
 *
 * So the comparison is done on a copy with the parts nobody reads removed:
 * tooltips, Material icons whose text content is their ligature name, and
 * anything hidden from assistive technology. Registered as a selector engine
 * rather than run ad hoc, which keeps it an ordinary Locator to the rest of the
 * driver, and passed as a string because Playwright ships the source into the
 * page — where esbuild's `__name` helper does not exist.
 */
export const VISIBLE_TEXT_ENGINE = `{
  _clean(el) {
    const copy = el.cloneNode(true);
    const noise = copy.querySelectorAll(
      'mat-icon,.mat-icon,.material-icons,[class*="material-icons"],' +
      '.tooltip,[class*="tooltip"],[aria-hidden="true"],script,style'
    );
    for (let i = 0; i < noise.length; i++) noise[i].remove();
    return (copy.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  },
  queryAll(root, selector) {
    const wanted = selector.replace(/\\s+/g, ' ').trim().toLowerCase();
    if (!wanted) return [];
    const scope = root.querySelectorAll ? root : document;
    const all = scope.querySelectorAll('*');
    const hits = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      // Cheap gate before the expensive clone: concatenated text must at least
      // contain the label. On a real page this leaves a handful of ancestors
      // out of several thousand elements.
      const raw = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      if (!raw.includes(wanted)) continue;
      if (this._clean(el) === wanted) hits.push(el);
    }
    // Innermost only. Every ancestor of a match whose extra content is all
    // noise matches too, and returning the outermost would hand back a wrapper
    // whose bounding box covers half the screen.
    return hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
  },
  query(root, selector) {
    return this.queryAll(root, selector)[0] || null;
  }
}`;

/** Registered once per process; a second call throws. */
let visibleTextRegistered = false;


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

export type { PopupRule } from './PopupInterceptor.js';

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
  /**
   * Popups that can appear at any time and should be silently dismissed before
   * each Playwright action, without needing explicit steps in the feature file.
   * Uses page.addLocatorHandler() under the hood.
   */
  popups?: PopupRule[];
  /** Disable on remote/farm workers: auth state must never leave the host. */
  persistAuthSessions?: boolean;
  /** Local-only directory, deliberately outside reports/artifacts. */
  authSessionDir?: string;
  /** Expired state is discarded and rebuilt through the login UI. */
  authSessionTtlMs?: number;
}

type BrowserStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

interface StoredAuthSession {
  version: 1;
  savedAt: string;
  state: BrowserStorageState;
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

  async accessibleName(): Promise<string | undefined> {
    // See the WebView driver: reported rather than swallowed, because a silent
    // undefined here reads as "no name" and quietly rejects the right element.
    return this.locator.evaluate(accessibleNameOf).catch((err: Error) => {
      console.log(`[a11y] không đọc được tên của ${this.candidate.strategy}:${this.candidate.value}: ${err.message.split('\n')[0]}`);
      return undefined;
    });
  }

  /** null for anything that is not an input/textarea/select — inputValue throws there. */
  async value(): Promise<string | null> {
    return this.locator.inputValue().catch(() => null);
  }

  async selected(): Promise<boolean | undefined> {
    return this.locator.evaluate((node) => {
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
    }).catch(() => undefined);
  }
}

export class WebUiDriver implements UiDriver {
  readonly platform: Platform = 'web';
  readonly device: string;

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private mcpObserver?: PlaywrightMcpObserver;
  private readonly popupInterceptor: PopupInterceptor;
  /** Hosts already warned about, so one blocked poller does not flood the log. */
  private readonly blocked = new Set<string>();

  constructor(private readonly opts: WebDriverOptions) {
    this.device = opts.device ?? 'chromium-desktop';
    this.popupInterceptor = new PopupInterceptor(opts.popups);
  }

  private get p(): Page {
    if (!this.page) throw new Error('WebUiDriver.start() was not called.');
    return this.page;
  }

  async start(): Promise<void> {
    await mkdir(this.opts.artifactsDir, { recursive: true });
    if (!visibleTextRegistered) {
      // Registration is global to the Playwright process and throws on a
      // repeat, so a second driver in the same run must not try again.
      await selectors.register('visibletext', { content: VISIBLE_TEXT_ENGINE })
        .catch((err: Error) => {
          console.warn(`[web] không đăng ký được selector visibletext: ${err.message}`);
        });
      visibleTextRegistered = true;
    }
    this.browser = await chromium.launch({
      headless: this.opts.headless ?? true,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
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
    await this.mcpObserver?.close().catch(() => {});
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
    if (!this.browser) return;
    // In headed mode, destroying BrowserContext closes the Chrome window and
    // the replacement context re-opens it at the emulated device size. Across
    // a suite that looks like the browser is continuously resizing. Keep one
    // fixed context/window for observation, but rotate the page and clear ALL
    // origin storage via CDP so scenario isolation remains strict.
    if (this.opts.headless === false && this.context) {
      if (this.page && !this.page.isClosed()) {
        const orphan = this.page.video();
        await this.clearScenarioStorage().catch((err) => {
          console.warn(`[web] không reset được storage trước scenario: ${(err as Error).message}`);
        });
        await this.page.close().catch(() => {});
        await orphan?.delete().catch(() => {});
      }
      this.page = await this.context.newPage();
      return;
    }

    // Close the previous context entirely — a new context is the only way to
    // guarantee a clean slate. clearCookies() leaves localStorage intact, and
    // SPAs that store auth tokens there (e.g. Angular with JWT) will redirect
    // straight to the home screen instead of the login page.
    if (this.context) {
      const orphan = this.page?.video();
      await this.context.close().catch(() => {});
      await orphan?.delete().catch(() => {});
    }
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
   * Restores Playwright cookies + localStorage from a private host-only file.
   * Loading state is intentionally not considered proof of authentication;
   * Executor validates the actual logged-in UI and invalidates stale state.
   */
  async restoreAuthenticatedSession(key: string): Promise<boolean> {
    const file = this.authSessionFile(key);
    if (!file || !this.context || !this.page) return false;
    let stored: StoredAuthSession;
    try {
      stored = JSON.parse(await readFile(file, 'utf8')) as StoredAuthSession;
    } catch {
      await unlink(file).catch(() => {});
      return false;
    }
    const ttl = this.opts.authSessionTtlMs ?? 8 * 60 * 60_000;
    const age = Date.now() - Date.parse(stored.savedAt);
    if (stored.version !== 1 || !Number.isFinite(age) || age < 0 || age > ttl) {
      await unlink(file).catch(() => {});
      return false;
    }

    try {
      if (stored.state.cookies.length > 0) await this.context.addCookies(stored.state.cookies);
      for (const origin of stored.state.origins) {
        await this.page.goto(origin.origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this.page.evaluate((entries) => {
          localStorage.clear();
          for (const entry of entries) localStorage.setItem(entry.name, entry.value);
        }, origin.localStorage);
      }
      await this.page.goto(this.opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return true;
    } catch {
      await this.invalidateAuthenticatedSession(key).catch(() => {});
      return false;
    }
  }

  async saveAuthenticatedSession(key: string): Promise<void> {
    const file = this.authSessionFile(key);
    if (!file || !this.context) return;
    const state = await this.context.storageState();
    const hasState = state.cookies.length > 0 || state.origins.some((origin) => origin.localStorage.length > 0);
    if (!hasState) return;
    const stored: StoredAuthSession = { version: 1, savedAt: new Date().toISOString(), state };
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => {});
  }

  async invalidateAuthenticatedSession(key: string): Promise<void> {
    const file = this.authSessionFile(key);
    if (file) await unlink(file).catch(() => {});
    await this.clearScenarioStorage();
    if (this.page && !this.page.isClosed()) {
      await this.page.goto(this.opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
  }

  private authSessionFile(key: string): string | undefined {
    if (this.opts.persistAuthSessions === false) return undefined;
    const digest = createHash('sha256')
      .update(`${this.opts.baseUrl}\0${this.device}\0${key}`)
      .digest('hex')
      .slice(0, 32);
    return path.join(this.opts.authSessionDir ?? '.testpilot/sessions', `${digest}.json`);
  }

  /** Closes the page so the video is flushed, then names it after the scenario. */
  async endScenario(scenarioId: string): Promise<string | undefined> {
    if (!this.page) return undefined;

    // Headed runs reuse their context to keep the visible Chrome window stable.
    // Clear state before closing the page; after close there is no execution
    // target left for Storage.clearDataForOrigin.
    if (this.opts.headless === false) {
      await this.clearScenarioStorage().catch((err) => {
        console.warn(`[web] không reset được storage sau scenario: ${(err as Error).message}`);
      });
    }

    if (!this.opts.record) {
      await this.page.close().catch(() => {});
      return undefined;
    }
    const video = this.page.video();
    if (!video) {
      await this.page.close().catch(() => {});
      return undefined;
    }

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

  /**
   * Browser-context reuse must not mean auth/session reuse. CDP's
   * Storage.clearDataForOrigin clears localStorage, IndexedDB, Cache Storage,
   * service-worker data and other origin-owned state in one atomic operation;
   * Playwright then clears cookies and permissions at context level.
   */
  private async clearScenarioStorage(): Promise<void> {
    if (!this.context || !this.page || this.page.isClosed()) return;

    const origins = new Set<string>();
    for (const value of [this.opts.baseUrl, this.page.url()]) {
      try {
        const url = new URL(value);
        if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
      } catch {
        // about:blank during initial setup has no origin-owned state.
      }
    }

    if (origins.size > 0) {
      const cdp = await this.context.newCDPSession(this.page);
      try {
        for (const origin of origins) {
          await cdp.send('Storage.clearDataForOrigin', {
            origin,
            storageTypes: 'all',
          });
        }
      } finally {
        await cdp.detach().catch(() => {});
      }
    }
    await this.context.clearCookies();
    await this.context.clearPermissions();
  }

  async launch(target?: string): Promise<void> {
    await this.p.goto(target ?? this.opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  async currentUrl(): Promise<string> {
    return this.p.url();
  }

  /**
   * Actively removes configured overlays before a lookup. Locator handlers are
   * still useful when a popup appears during a click, but they do not run for
   * every read-only locator operation. Without this explicit pass, an element
   * can be found behind a modal and the next lookup can wait forever.
   */
  async dismissOverlay(protect: string[] = []): Promise<boolean> {
    return Boolean(await this.popupInterceptor.dismissOne(this.p, protect));
  }

  /**
   * Closes overlays standing between the run and the next action — except the
   * one the action itself is aimed at. See protectedSelectors().
   */
  private async clearOverlays(protect: string[] = []): Promise<void> {
    await this.popupInterceptor.clear(this.p, protect);
  }

  async find(c: LocatorCandidate): Promise<UiHandle | null> {
    // Popup handling is owned once per resolver tick and once immediately
    // before an interaction. Doing a full interceptor pass here made every
    // candidate in a missing-locator poll rescan the same large Angular DOM.
    // Tried in order, never unioned. A union is resolved in document order, and
    // a caption always precedes the control it names — so `getByText` matching
    // `<legend>KL đặt</legend>` would win over the `<input>` the step meant, and
    // fill() failed with "Element is not an <input>". Unioning also costs a
    // hittability probe per match, which on a real page turned one polling tick
    // into the whole resolve budget.
    //
    // Associations come first because they are the more specific answer: when a
    // caption is tied to a control, the control is what the step is about —
    // clicking a label focuses its input anyway. The Playwright pass stays as
    // the fallback for what XPath cannot express: ARIA-computed names, and
    // Vietnamese tone-mark variants such as "Xoá" against "Xóa".
    for (const locator of this.labelFirstOrder(c)) {
      const found = await this.probe(c, locator);
      if (found) return found;
    }
    return null;
  }

  async inspectMatches(candidate: LocatorCandidate): Promise<UiMatchSnapshot> {
    await this.clearOverlays(protectedSelectors([candidate]));
    // The same order `find` uses, not a freshly built locator.
    //
    // These two disagreed: `find` located "Tiền chuyển (Phí = 0)" through the
    // visible-text engine while this method rebuilt the plain Playwright
    // locator, which matches nothing — so the element resolved, the step ran,
    // and the assertion compared against an empty string. A resolution that is
    // then read back through a different locator is not the same resolution.
    let locator = this.toLocator(candidate);
    for (const variant of this.labelFirstOrder(candidate)) {
      if ((await variant.count().catch(() => 0)) > 0) { locator = variant; break; }
    }
    return locator.evaluateAll((nodes) => {
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
    });
  }

  private labelFirstOrder(c: LocatorCandidate): Locator[] {
    const playwright = this.toLocator(c);
    if (c.strategy !== 'label') return [playwright];
    const root = c.runtimeScope ? this.p.locator(c.runtimeScope) : this.p;
    const ordered = labelXPathsBySpelling(c.value)
      .map((arms) => root.locator(`xpath=${arms.join(' | ')}`));
    ordered.push(playwright);
    // After the exact arms and before the loose one. It is stricter than the
    // loose arm — the cleaned text must equal the label, not merely contain it
    // — but costs a walk of the document, so it does not run while a cheap
    // exact match is still possible.
    ordered.push(root.locator(`visibletext=${c.value}`));
    // The same reading as `visibletext`, expressed as an xpath.
    //
    // Redundant here and deliberately so: the selector engine does not reach a
    // context Playwright merely attached to over CDP, so the WebView driver has
    // only this arm. Keeping both drivers on the same rule is what stops the
    // desktop build resolving a caption the phone cannot find — which is
    // exactly how three scenarios failed on Android and nowhere else.
    const split = labelSplitAcrossChildrenXPath(c.value);
    if (split) ordered.push(root.locator(`xpath=${split}`));
    // Last, and only when nothing exact was found: a message carrying data.
    const loose = labelContainsXPath(c.value);
    if (loose) ordered.push(root.locator(`xpath=${loose}`));
    return ordered;
  }

  private async probe(c: LocatorCandidate, locator: Locator): Promise<UiHandle | null> {
    const first = locator.first();
    // A resolver owns the overall waiting budget and retries all candidates.
    // Playwright defines timeout:0 as "wait forever", so never use it here.
    // Keep a single probe short to avoid one missing selector freezing a run.
    //
    // Label associations get longer: they are nine XPath arms walking the whole
    // document, and on a busy Angular page one spelling measured ~350ms — past
    // the general budget while the element was sitting right there. A cheap
    // selector still fails fast; only the strategy that is known to cost more
    // is given more.
    const budget = c.strategy === 'label' ? 900 : 250;
    try {
      await first.waitFor({ state: 'attached', timeout: budget });
    } catch {
      return null;
    }
    // Happy path: the first match is usually on screen, and one question to the
    // page settles it. Only when it is off-screen — a drawer item sharing its
    // label with the visible tab — is it worth counting and scanning the rest.
    if (!(await isHittable(first))) {
      const count = await locator.count().catch(() => 1);
      for (let i = 1; i < count; i++) {
        const nth = locator.nth(i);
        if (await isHittable(nth)) return new WebHandle(c, nth);
      }
    }
    return new WebHandle(c, first);
  }

  private toLocator(c: LocatorCandidate): Locator {
    const root = c.runtimeScope ? this.p.locator(c.runtimeScope) : this.p;
    if (c.strategy === 'relative') return toRelativePlaywrightLocator(root, c);
    switch (c.strategy) {
      case 'testId':
        return root.getByTestId(c.value);
      case 'role':
        return root.getByRole(c.value as Parameters<Page['getByRole']>[0], {
          ...(c.name ? { name: c.name } : {}),
        });
      case 'label':
        // Try the accessible label first, then human text. The regular
        // expression accepts equivalent Vietnamese tone-mark placement such as
        // "Xoá" and "Xóa", while remaining exact after normalisation.
        //
        // The broader label-association arms are NOT unioned in here — see
        // labelFallback(), used only when this finds nothing.
        return root.getByLabel(c.value).or(root.getByText(humanTextRegex(c.value)));
      case 'placeholder':
        return root.getByPlaceholder(c.value);
      case 'css':
        return root.locator(c.value);
      case 'xpath':
        return root.locator(`xpath=${c.value}`);
      case 'predicate':
        throw new Error('The "predicate" strategy is iOS-only and has no web equivalent.');
    }
  }

  async tap(h: UiHandle): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
    // The executor owns retries and postcondition verification. Do not let one
    // covered/stale candidate consume Playwright's 30 s default timeout before
    // the executor can reject it and try the next candidate.
    const root = (h as WebHandle).locator;
    // A business label may describe a composite header (for example "Giá 1M")
    // while Angular attaches the actual tooltip listener to one child span.
    // Clicking the centre of the header misses that directive. Prefer the one
    // explicit tooltip trigger inside the resolved control; the surrounding
    // locator still proves the business region and prevents cross-page matches.
    const tooltipTrigger = root.locator('[apppopuphover],[tcbstooltip]').first();
    const locator = await tooltipTrigger.isVisible({ timeout: 200 }).catch(() => false)
      ? tooltipTrigger
      : root;
    try {
      await locator.click({ timeout: 5_000 });
    } catch (err) {
      // A notification can arrive after clearOverlays() but before the click
      // actionability check. Close only a semantically safe overlay and retry
      // the same verified locator once; all other failures keep their original
      // error and are handled by executor healing.
      // The page may have produced an overlay after the cached pre-action
      // check. Bypass the short negative cache on this actionability failure.
      const dismissed = await this.popupInterceptor.clear(this.p, [], 10, true);
      if (dismissed > 0) {
        await locator.click({ timeout: 5_000 });
        return;
      }
      if (await this.clickAnotherMatch(h as WebHandle)) return;
      throw err;
    }
  }

  /**
   * Clicks a different element matching the same locator.
   *
   * A label can belong to several nodes — a drawer item and the visible tab
   * both read "Trái phiếu" — and only one of them can be clicked. find() picks
   * the hittable one, but that judgement is made before the click and can be
   * wrong. The last word belongs to Playwright's own actionability check, the
   * thing that rejected the first candidate to begin with: whichever twin
   * accepts a click is the one the step meant.
   *
   * Only reached after a click has already failed, so a passing run pays
   * nothing for it.
   */
  private async clickAnotherMatch(handle: WebHandle): Promise<boolean> {
    // A relative locator is an expression rebuilt from row context, not a
    // selector whose matches can be enumerated this way.
    if (handle.candidate.strategy === 'relative') return false;

    const all = this.toLocator(handle.candidate);
    const count = await all.count().catch(() => 0);
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

  async hover(h: UiHandle): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
    await (h as WebHandle).locator.hover({ timeout: 5_000 });
  }

  async dragDrop(source: UiHandle, target: UiHandle): Promise<void> {
    await this.clearOverlays(protectedSelectors([(source as WebHandle).candidate]));
    await (source as WebHandle).locator.dragTo((target as WebHandle).locator, {
      timeout: 8_000,
    });
  }

  async longPress(h: UiHandle, ms: number): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
    await (h as WebHandle).locator.click({ delay: ms });
  }

  async input(h: UiHandle, text: string, typeDelay?: number): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
    const loc = (h as WebHandle).locator;
    if (typeDelay && typeDelay > 0) {
      await loc.clear();
      await loc.pressSequentially(text, { delay: typeDelay });
      // Autocomplete APIs usually debounce after the final key. Give the
      // component one debounce window before the next step queries results.
      await this.p.waitForTimeout(500);
      return;
    }
    await loc.fill(text);
    // Some Angular reactive-form fields (e.g. search inputs) only update their
    // model on `keyup`.  After fill(), the value is set but the component has
    // not triggered a search yet.  Dispatching a keyup event from within the
    // page context is the minimal fix that doesn't break normal fields.
    await loc.dispatchEvent('keyup', { key: 'Process', bubbles: true }).catch(() => {});
  }

  async selectDate(h: UiHandle, date: string): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
    await selectDateWithPlaywright((h as WebHandle).locator, date);
  }

  async inspectControl(h: UiHandle): Promise<ControlInspection> {
    const inspection = await inspectPlaywrightControl((h as WebHandle).locator);
    if (inspection.type !== 'date') return inspection;
    this.mcpObserver ??= new PlaywrightMcpObserver(() => this.context);
    const hints = await this.mcpObserver.controlHints('date').catch(() => []);
    return { ...inspection, evidence: [...new Set([...inspection.evidence, ...hints])] };
  }

  async clear(h: UiHandle): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
    await (h as WebHandle).locator.fill('');
  }

  /**
   * Choose a value from a dropdown, native or not.
   *
   * `selectOption` only drives a real `<select>`. This application builds its
   * dropdowns from Angular Material, which renders a `role="combobox"` div and
   * a detached options panel, so every `I select ... from ...` step failed with
   * "Element is not a <select> element" — five scenarios of a new feature, all
   * on the same line, with a locator that had found precisely the right
   * control. The locator was never the problem; the action was.
   *
   * The native path stays first because when it applies it is atomic and
   * cannot half-happen.
   */
  async listOptions(h: UiHandle): Promise<string[] | undefined> {
    const handle = h as WebHandle;
    const expanded = await handle.locator
      .evaluate((node) => (node as Element).getAttribute('aria-expanded'))
      .catch(() => null);
    if (expanded !== 'true') {
      // See the driver interface: opening is part of the contract, because a
      // closed dropdown reads as zero choices and would make "not among the
      // choices" pass without checking anything.
      await this.clearOverlays(protectedSelectors([handle.candidate]));
      await handle.locator.click();
    }
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
      const now = await this.p.evaluate(openOptionLabels).catch(() => []);
      if (now.length > 0 && now.length === previous) return now;
      previous = now.length;
      seen = now;
      await this.p.waitForTimeout(200);
    }
    return seen;
  }

  async selectOption(h: UiHandle, option: string): Promise<void> {
    const handle = h as WebHandle;
    await this.clearOverlays(protectedSelectors([handle.candidate]));
    try {
      await handle.locator.selectOption({ label: option });
      return;
    } catch (err) {
      if (!/not a <select> element/i.test((err as Error).message)) throw err;
    }

    // Opening the panel creates a `.cdk-overlay-pane`, which is exactly what
    // the popup interceptor exists to close. No overlay clearing may happen
    // between here and the click on the option, or the run would dismiss the
    // list it just asked for.
    await handle.locator.click();
    const panel = this.p.locator(CUSTOM_OPTION_PANEL).last();
    await panel.waitFor({ state: 'visible', timeout: 5_000 });

    const choice = panel.getByRole('option', { name: option, exact: true }).first();
    const fallback = panel.locator(CUSTOM_OPTION).filter({ hasText: option }).first();
    const target = (await choice.count()) > 0 ? choice : fallback;
    await target.click({ timeout: 5_000 });

    // A dropdown that closed without taking the value looks identical to one
    // that worked: the panel is gone either way. Reading the control back is
    // the only thing that separates them.
    const shown = (await handle.locator.textContent().catch(() => '')) ?? '';
    if (!normalizeHumanText(shown).includes(normalizeHumanText(option))) {
      throw new Error(
        `Đã chọn "${option}" trong dropdown nhưng control vẫn hiển thị "${shown.trim()}".`,
      );
    }
  }

  /**
   * Read the value that sits beside a caption.
   *
   * Walks outward rather than guessing at class names, which differ per screen
   * and per component library: the value is the nearest following element that
   * carries text of its own, first among siblings, then among the parent's
   * siblings for the common wrapper-per-cell markup. Anything that merely
   * repeats the caption is skipped — that is the node we already have.
   */
  async captionValue(h: UiHandle): Promise<string | undefined> {
    const caption = (await (h as WebHandle).locator.innerText().catch(() => '')) ?? '';
    return (h as WebHandle).locator
      .evaluate(valueBesideCaption, caption)
      .catch((err: Error) => {
        // Reported rather than hidden: a caption with no value beside it returns
        // undefined normally, so a silent undefined here would be
        // indistinguishable from that and the cause would never surface.
        console.warn(`[web] không đọc được giá trị cạnh nhãn: ${err.message.split('\n')[0]}`);
        return undefined;
      });
  }


  async scrollIntoView(h: UiHandle): Promise<void> {
    await this.clearOverlays(protectedSelectors([(h as WebHandle).candidate]));
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

  async dumpTree(name: string): Promise<string> {
    const file = path.join(this.opts.artifactsDir, `${sanitize(name)}.html`);
    const html = await Promise.race([
      this.p.content(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('DOM dump timeout')), 3_000),
      ),
    ]);
    await writeFile(file, html, 'utf8');
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
    // p.evaluate() has no built-in timeout and blocks on the page's main thread.
    // Heavy charting/real-time JS (e.g., the home screen after login) can
    // monopolize the thread for minutes. Cap at 8 s so discovery never hangs.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('observe timeout')), 8_000),
    );
    return Promise.race([this.p.evaluate(OBSERVE_DOM) as Promise<Observed[]>, timeout]);
  }

  async observeAccessibility(): Promise<Observed[]> {
    this.mcpObserver ??= new PlaywrightMcpObserver(() => this.context);
    return this.mcpObserver.observe();
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

/** Exact visible-text pattern tolerant of Vietnamese diacritics and whitespace. */
function humanTextRegex(value: string): RegExp {
  const classes: Record<string, string> = {
    a: 'aàáảãạăằắẳẵặâầấẩẫậ',
    e: 'eèéẻẽẹêềếểễệ',
    i: 'iìíỉĩị',
    o: 'oòóỏõọôồốổỗộơờớởỡợ',
    u: 'uùúủũụưừứửữự',
    y: 'yỳýỷỹỵ',
    d: 'dđ',
  };
  const normalized = normalizeHumanText(value);
  const pattern = Array.from(normalized).map((ch) => {
    if (/\s/u.test(ch)) return '\\s+';
    const chars = classes[ch];
    if (chars) return `[${chars}]`;
    return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^\\s*${pattern}\\s*$`, 'iu');
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
            'h1,h2,h3,h4,h5,h6,label,[onclick],tcbs-icon[name],span,p,li,.cursor-pointer,' +
            '.navigation-list > div,[role="tablist"] > *,' +
            '[class*="tab-list"] > *,[class~="tabs"] > *,[class*="period"] > *,' +
            ${JSON.stringify(ROW_SELECTOR)};
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
    // Custom web components commonly expose their semantic identity through a
    // stable name attribute while rendering no text at all. TCInvest's add
    // stock control is exactly this shape: <tcbs-icon name="Circle add">.
    var customName = el.tagName.indexOf('-') >= 0 && el.getAttribute('name');
    if (customName) {
      var byName = el.tagName.toLowerCase() + '[name=' + JSON.stringify(String(customName)) + ']';
      if (document.querySelectorAll(byName).length === 1) return byName;
    }
    // A repeated row has no id and no unique text, so the fallback below would
    // hand back div:nth-of-type(7). Inside a virtualised list that is worse
    // than nothing: scrolling renumbers every row. The class the rows share
    // names the group instead, which is what a collection assertion — "at most
    // five suggestions", "the list shows VIC" — is actually about, and it
    // survives scrolling. Restricted to rows on purpose: for everything else a
    // shared class would be a step backwards from a unique selector.
    if (el.matches(${JSON.stringify(ROW_SELECTOR)})) {
      var classes = String(el.getAttribute('class') || '').split(/\\s+/).filter(Boolean);
      var known = ${JSON.stringify([...ROW_CLASS_TOKENS])};
      // Meaningful names first. A row typically also carries framework classes
      // — cdk-drag, ng-star-inserted — that group the same nodes today for
      // reasons that have nothing to do with being a row, so taking whichever
      // class comes first in the attribute picks one of those by luck.
      var ordered = classes.filter(function (c) { return known.indexOf(c) >= 0; })
        .concat(classes.filter(function (c) { return known.indexOf(c) < 0; }));
      for (var ci = 0; ci < ordered.length; ci++) {
        var token = ordered[ci];
        // Skip hashed/generated names: they change on every build.
        if (!/^[a-z][a-z0-9-]*$/i.test(token) || token.length < 4) continue;
        var group = document.querySelectorAll('.' + CSS.escape(token));
        if (group.length > 1 && group[0].tagName === el.tagName) return '.' + CSS.escape(token);
      }
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

  function regionFor(el) {
    var branch = el;
    var node = el.parentElement;
    for (var depth = 0; node && node !== document.body && depth < 8; depth += 1) {
      var children = Array.prototype.slice.call(node.children || []);
      for (var i = 0; i < children.length; i += 1) {
        var child = children[i];
        if (child === branch || child.contains(el) || !visible(child)) continue;
        var tag = child.tagName.toLowerCase();
        var role = String(child.getAttribute('role') || '').toLowerCase();
        var klass = String(child.getAttribute('class') || '').toLowerCase();
        var headingLike = /^h[1-6]$/.test(tag) || role === 'heading' ||
          /(?:^|[\\s_-])(title|header|heading)(?:[\\s_-]|$)/.test(klass);
        if (!headingLike) continue;
        var heading = (child.innerText || '').trim().replace(/\\s+/g, ' ');
        if (heading && heading.length <= 100) return [heading];
      }
      branch = node;
      node = node.parentElement;
    }
    return [];
  }

  var IMPLICIT = { a: 'link', button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox' };

  return Array.prototype.slice.call(document.querySelectorAll(SEL))
    .filter(visible)
    .map(function (el) {
      var tag = el.tagName.toLowerCase();
      var customControl = tag.indexOf('-') >= 0 && el.hasAttribute('name');
      // Angular/Tailwind frequently attaches click handlers through framework
      // bindings, so no onclick attribute exists in the rendered HTML. The
      // computed pointer cursor is the runtime evidence that the wrapper is an
      // actionable control (e.g. the "Xóa khỏi danh mục" drawer row).
      var pointerControl = getComputedStyle(el).cursor === 'pointer';
      // Angular component libraries often render tab/range choices as plain
      // leaf divs and attach the click listener through the framework. There
      // is no onclick attribute and some themes omit cursor:pointer. The
      // repeated children of a semantic navigation/tab/period wrapper are the
      // runtime evidence that each leaf is a selectable option.
      var parent = el.parentElement;
      var parentSemantic = parent
        ? String(parent.getAttribute('role') || parent.getAttribute('class') || '').toLowerCase()
        : '';
      var navigationControl = tag === 'div' && el.children.length === 0 && !!parent &&
        parent.children.length > 1 &&
        /(?:^|[\\s_-])(navigation|nav|tabs?|tablist|segment|period)(?:[\\s_-]|$)/.test(parentSemantic);
      var role = el.getAttribute('role') || IMPLICIT[tag] ||
                 (navigationControl ? 'tab' : customControl || pointerControl ? 'button' : tag);
      var n = seen[role] || 0;
      seen[role] = n + 1;
      var text = (el.innerText || '').trim().replace(/\\s+/g, ' ');
      return {
        testId: el.getAttribute('data-testid') || el.getAttribute('data-test') ||
                el.getAttribute('data-cy') || undefined,
        role: role,
        name: el.getAttribute('aria-label') || el.getAttribute('title') ||
              (customControl ? el.getAttribute('name') : undefined) || undefined,
        text: text && text.length <= 80 ? text : undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        css: cssFor(el),
        context: regionFor(el),
        interactive: /^(a|button|input|select|textarea)$/.test(tag) ||
                     el.hasAttribute('onclick') || customControl || pointerControl || navigationControl,
        index: n,
        container: el.children.length > 0,
      };
    });
})()`;
