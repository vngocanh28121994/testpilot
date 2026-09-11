import type { Locator, Page } from 'playwright';

/** App-specific fallback for a popup whose safe close control is known. */
export interface PopupRule {
  detect: string;
  dismiss: string;
}

export interface PopupDismissResult {
  root: string;
  control: string;
  /**
   * What the overlay said, captured before it was closed.
   *
   * Logged so a dismissal is visible in the run rather than silent. Without it
   * the only trace of a closed dialog is its absence, and a step that then
   * reports "the message never appeared" is describing a page this class
   * emptied — which is exactly how a validation dialog carrying the expected
   * text produced three separate wrong diagnoses.
   */
  text?: string;
  source: 'semantic' | 'configured';
}

/**
 * Shared Playwright popup interceptor for browser pages and Android WebViews.
 *
 * It closes one visual layer at a time, always starting with the top-most
 * visible dialog. Only controls with explicit dismiss semantics are eligible;
 * positive/submit actions such as Agree, Confirm, Buy, or Continue are never
 * inferred as safe.
 */
/** Đóng ngần này lần mà hộp thoại vẫn hiện lại thì coi như nó không đóng được. */
const STUCK_LIMIT = 3;

/** Nghỉ bao lâu trước khi thử lại một hộp thoại đã bị coi là không đóng được. */
const STUCK_COOLDOWN_MS = 30_000;

export class PopupInterceptor {
  private negativeUntil = 0;
  private negativePage?: Page;
  private negativeProtectKey = '';
  /**
   * What the application last said, and when.
   *
   * Retained rather than only logged, because dismissing a dialog destroys the
   * one piece of evidence that separates two very different failures: a step
   * that clicked the wrong element, and a step that clicked the right one and
   * was told no. Both look identical afterwards — an expected screen that never
   * arrived — and healing, unable to tell them apart, blamed the locator and
   * went hunting through other candidates on a live account.
   */
  private lastSaid?: { text: string; at: number };
  /**
   * Hộp thoại vừa "đóng" gần nhất, và số lần đóng đi đóng lại y hệt.
   *
   * Một lượt chạy thật đã ghi 77 dòng "closed top #mat-dialog-1 via CLOSE" cho
   * đúng một hộp thoại Bộ lọc, cùng một nút, cùng một nội dung. Mỗi lần báo
   * thành công lại xoá bộ nhớ phủ định, nên bộ tắt popup không bao giờ nhận ra
   * nó đang giậm chân — và lượt chạy quay vòng cho tới khi hết giờ.
   *
   * Đóng mà hộp thoại vẫn còn đó thì lần thứ tư không khác gì lần thứ ba: dừng
   * lại và nói ra, để cái đang chặn lộ diện thay vì bị che sau một vòng lặp.
   */
  private stuck?: { key: string; times: number };

  constructor(
    private readonly rules: PopupRule[] = [],
    private readonly log: (message: string) => void = console.log,
  ) {}

  /**
   * What the application said since `since`, if anything.
   *
   * The caller asks after an action whose expected outcome did not arrive. A
   * message here means the application received the interaction and answered —
   * so the locator found the right control, and looking for a better one is
   * both pointless and, on a live account, unsafe.
   */
  saidSince(since: number): string | undefined {
    return this.lastSaid && this.lastSaid.at >= since ? this.lastSaid.text : undefined;
  }

  async clear(
    page: Page,
    protect: string[] = [],
    maxLayers = 10,
    force = false,
  ): Promise<number> {
    let dismissed = 0;
    for (let layer = 0; layer < maxLayers; layer++) {
      const result = await this.dismissOne(page, protect, { force });
      if (!result) break;
      dismissed += 1;
      // Angular Material/CDK removes a dialog after its leave animation. Wait
      // for that exact layer when it has an id; otherwise allow one animation
      // frame budget before identifying the next top-most layer. Without this,
      // the same button can be clicked repeatedly while its dialog is fading.
      if (result.root.startsWith('#')) {
        await page.locator(result.root).first()
          .waitFor({ state: 'hidden', timeout: 800 })
          .catch(() => page.waitForTimeout(250));
      } else {
        await page.waitForTimeout(250);
      }
    }
    return dismissed;
  }

  /**
   * @param protect CSS selectors whose containing layer must be left alone.
   */
  async dismissOne(
    page: Page,
    protect: string[] = [],
    opts: { force?: boolean } = {},
  ): Promise<PopupDismissResult | null> {
    const protectKey = [...protect].sort().join('\u0000');
    // Resolver polling may ask the same question several times per second. A
    // full DOM scan before every candidate made a missing locator spend most of
    // its timeout proving that the same popup was still absent. Cache only a
    // negative answer, and key it by the protected target so a dialog spared
    // for one assertion can still be closed by the next action.
    if (
      !opts.force &&
      this.negativePage === page &&
      (this.negativeProtectKey === '*' || this.negativeProtectKey === protectKey) &&
      Date.now() < this.negativeUntil
    ) return null;

    // Known app popups have precise selectors and should never pay for the
    // generic full-DOM semantic scan first. On TCInvest's live price board the
    // charting thread can delay page.evaluate() for tens of seconds, while a
    // configured locator closes the same coach mark immediately.
    const configured = await this.dismissConfigured(page, protect);
    if (configured) return configured;

    // The list is baked into the source rather than passed as an argument.
    // Playwright evaluates a *string* expression and returns its value: given a
    // function it returns the unserialisable function itself, i.e. undefined —
    // which silently turned every dismissal into a no-op. An IIFE has to close
    // over its input, and the script cannot be passed as a real function
    // because of the keepNames trap described above.
    const script = SMART_DISMISS_SCRIPT.replace('__PROTECT__', JSON.stringify(protect));
    const semantic = await page.evaluate(script)
      .catch(() => null) as PopupDismissResult | null;
    if (semantic) {
      const key = `${semantic.root}\u0000${semantic.control}\u0000${semantic.text ?? ''}`;
      this.stuck = this.stuck?.key === key
        ? { key, times: this.stuck.times + 1 }
        : { key, times: 1 };
      if (this.stuck.times > STUCK_LIMIT) {
        // Chỉ nói một lần, rồi im: chính việc lặp lại là thứ đang cần dập.
        if (this.stuck.times === STUCK_LIMIT + 1) {
          this.log(
            `[popup] ${semantic.root} đóng ${STUCK_LIMIT} lần vẫn hiện lại — thôi đóng nữa.`
            + (semantic.text ? `\n[popup]   nội dung: "${semantic.text.slice(0, 120)}"` : ''),
          );
        }
        this.negativePage = page;
        this.negativeProtectKey = protectKey;
        this.negativeUntil = Date.now() + STUCK_COOLDOWN_MS;
        return null;
      }
      this.clearNegativeCache();
      if (semantic.text) this.lastSaid = { text: semantic.text, at: Date.now() };
      this.log(
        `[popup] closed top ${semantic.root} via ${semantic.control}`
        + (semantic.text ? `\n[popup]   nội dung: "${semantic.text}"` : ''),
      );
      return semantic;
    }

    this.negativePage = page;
    this.negativeProtectKey = protectKey;
    this.negativeUntil = Date.now() + 500;
    return null;
  }

  private async dismissConfigured(
    page: Page,
    protect: string[],
  ): Promise<PopupDismissResult | null> {
    // Refuse to click when another element physically covers the configured
    // control; this prevents a lower dialog's "deny" button from being
    // activated through an unknown upper dialog.
    for (const rule of this.rules) {
      const detect = page.locator(rule.detect).first();
      if (!(await detect.isVisible().catch(() => false))) continue;
      if (await holdsProtected(detect, protect)) continue;
      const dismiss = page.locator(rule.dismiss).first();
      if (!(await dismiss.isVisible().catch(() => false))) continue;
      try {
        // Playwright's trial click performs the same visibility/coverage/
        // stability checks as a real user click without dispatching it. This
        // replaces two page.evaluate() calls which could wait tens of seconds
        // behind TCInvest's charting work on the main thread.
        await dismiss.click({ trial: true, timeout: 800 });
        await dismiss.click({ timeout: 1_500 });
        const result: PopupDismissResult = {
          root: rule.detect,
          control: rule.dismiss,
          source: 'configured',
        };
        // A resolver probe is normally followed immediately by the action on
        // the element it just found. The configured popup has already been
        // removed, so rescanning the whole Angular DOM during that action is
        // both redundant and, on TCInvest's chart-heavy price board, can block
        // page.evaluate() for tens of seconds. Remember a short "clear" window.
        // If another layer really blocks the click, WebUiDriver retries with
        // force=true, which deliberately bypasses this cache.
        // The resolver protects every candidate while the following action
        // protects only the winning candidate. Those keys are intentionally
        // different, but they are still the same user operation. Make this
        // short post-dismiss cache apply to either key.
        this.rememberNegative(page, protect, 2_000, true);
        this.log(`[popup] closed configured overlay via ${rule.dismiss}`);
        return result;
      } catch {}
    }
    return null;
  }

  private clearNegativeCache(): void {
    this.negativePage = undefined;
    this.negativeProtectKey = '';
    this.negativeUntil = 0;
  }

  private rememberNegative(
    page: Page,
    protect: string[],
    durationMs: number,
    anyProtect = false,
  ): void {
    this.negativePage = page;
    this.negativeProtectKey = anyProtect ? '*' : [...protect].sort().join('\u0000');
    this.negativeUntil = Date.now() + durationMs;
  }
}

/** True when this layer contains something the caller asked to keep. */
async function holdsProtected(root: Locator, protect: string[]): Promise<boolean> {
  if (protect.length === 0) return false;
  for (const selector of protect) {
    if (selector.startsWith('text=')) {
      const wanted = selector.slice(5).replace(/\s+/g, ' ').trim();
      if (!wanted) continue;
      const exact = await root.getByText(wanted, { exact: true }).count().catch(() => 0);
      if (exact > 0) return true;
      if (wanted.split(/\s+/).length >= 3) {
        const partial = await root.getByText(wanted, { exact: false }).count().catch(() => 0);
        if (partial > 0) return true;
      }
      continue;
    }
    const count = await root.locator(selector).count().catch(() => 0);
    if (count > 0) return true;
  }
  return false;
}

// Kept as a string because tsx/esbuild's keepNames transform can inject helpers
// into serialised callbacks that do not exist inside the browser/WebView.
/**
 * Chỉ là một CHUỖI, và điều đó có ích ngoài Playwright.
 *
 * `page.evaluate` nhận chuỗi, mà `browser.execute` của Appium cũng vậy — nên
 * cùng đúng đoạn quét này chạy được trong WebView của iOS, nơi không có
 * Playwright Page nào để cầm. Xem NativeUiDriver.dismissDomPopup().
 */
export const SMART_DISMISS_SCRIPT = `(() => {
  var protect = __PROTECT__;
  var ROOTS = '[role="dialog"],[aria-modal="true"],mat-dialog-container,' +
    '.driver-popover,.cdk-overlay-pane,.modal.show,.modal[style*="display: block"],' +
    // TCInvest renders asynchronous security notices as a custom overlay
    // rather than a dialog. Its explicit close button still goes through the
    // same safe-dismiss scoring below; positive links are never selected.
    'app-notification-outbox .bottom-notification,' +
    // Onboarding coach marks, likewise not dialogs: a bubble at z-index 10000
    // and an arrow at 10001, over a full-screen pointer-events:auto backdrop.
    // Nothing above matched them, so they were never dismissed — and because
    // they appear at their own pace, one swallowed a tap on a different step
    // every run. Matched as a family rather than by one class: the same
    // mechanism serves every screen that has a coach mark, and only the bubble
    // carries the button. Its text is "Đã hiểu", which SAFE_TEXT already knows.
    '[class*="draggable-guide"]';
  var CONTROLS = 'button,[role="button"],a';
  var SAFE_TEXT = new Set([
    'ĐÓNG','CLOSE','BỎ QUA','SKIP','TỪ CHỐI','KHÔNG CHO PHÉP','DENY',
    'CANCEL','HỦY','HUỶ','ĐỂ SAU','NOT NOW','NO THANKS','OK','GOT IT',
    'ĐÃ HIỂU','×','✕'
  ]);

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }
  function norm(value) {
    return String(value || '').replace(/\\s+/g, ' ').trim().toUpperCase();
  }
  // Does this layer hold something the caller asked to keep? A "text=" entry
  // matches an element whose whole visible text is exactly that string —
  // partial matching would let one common word protect every dialog on screen.
  function holds(root, sel) {
    if (String(sel).indexOf('text=') === 0) {
      var want = norm(String(sel).slice(5));
      if (!want) return false;
      if (norm(root.textContent) === want) return true;
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (norm(all[i].textContent) === want) return true;
      }
      // A phrase specific enough to find an element by is specific enough to
      // protect the layer holding it. Exact equality could never do that for a
      // message: the step states "Đã lưu lệnh Mua", the toast reads "Đã lưu
      // lệnh Mua TCB 28000 x 100 = 2,800,000 vào Sổ lệnh chờ gửi". Unprotected,
      // this dismisser closed the very toast the step was waiting to assert on
      // — its ✕ counts as a safe control — and the assertion then failed
      // against a screen we had cleared ourselves.
      //
      // Same three-word floor as the loose locator match, for the same reason:
      // "OK" inside a sentence is a coincidence.
      if (want.split(/\\s+/).length >= 3) {
        if (norm(root.textContent).indexOf(want) !== -1) return true;
      }
      return false;
    }
    try {
      return root.querySelector(sel) !== null || root.matches(sel);
    } catch (e) {
      // Not every locator is valid CSS; an unusable one protects nothing.
      return false;
    }
  }
  function depth(el) {
    var n = 0, cur = el;
    while (cur && cur.parentElement) { n++; cur = cur.parentElement; }
    return n;
  }
  function effectiveZ(el) {
    var max = 0, cur = el;
    while (cur && cur instanceof HTMLElement) {
      var z = parseInt(getComputedStyle(cur).zIndex, 10);
      if (Number.isFinite(z)) max = Math.max(max, z);
      cur = cur.parentElement;
    }
    return max;
  }
  function score(control) {
    if (!visible(control) || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return 0;
    var aria = norm(control.getAttribute('aria-label'));
    var title = norm(control.getAttribute('title'));
    var cls = String(control.className || '').toLowerCase();
    var text = norm(control.textContent);
    var icons = Array.from(control.querySelectorAll('mat-icon,tcbs-icon,.material-icons'))
      .map(function (icon) { return norm(icon.textContent); });
    if (/^(CLOSE|DISMISS|CANCEL|ĐÓNG|BỎ QUA|HỦY|HUỶ)$/.test(aria)) return 120;
    if (/^(CLOSE|DISMISS|CANCEL|ĐÓNG|BỎ QUA|HỦY|HUỶ)$/.test(title)) return 115;
    if (/driver-popover-close-btn|(^|[-_ ])close([-_ ]|$)|dialog-close/.test(cls)) return 110;
    if (icons.some(function (icon) { return /^(CLOSE|CLEAR|CANCEL)$/.test(icon); })) return 105;
    if (SAFE_TEXT.has(text)) return 90;
    return 0;
  }

  var roots = Array.from(document.querySelectorAll(ROOTS)).filter(visible);
  // Never close a layer that holds what the caller is currently looking for.
  // The resolver polls and dismisses on the same tick, so an app that answers a
  // failed login with a dialog had that dialog closed by the very step waiting
  // to assert on it — the assertion then failed against a screen that had been
  // correct a moment earlier.
  if (protect && protect.length) {
    roots = roots.filter(function (root) {
      return !protect.some(function (sel) { return holds(root, sel); });
    });
  }
  // A CDK pane commonly contains mat-dialog-container. Treat that nested tree
  // as one layer by retaining only the innermost visible root.
  roots = roots.filter(function (root) {
    return !roots.some(function (other) { return other !== root && root.contains(other); });
  });
  if (!roots.length) return null;
  var ranked = roots.map(function (root, order) {
    return { root: root, z: effectiveZ(root), order: order, depth: depth(root) };
  }).sort(function (a, b) {
    return b.z - a.z || b.order - a.order || b.depth - a.depth;
  });
  // Walk down from the top, but only past layers that are purely decorative.
  //
  // Coach marks ship as several stacked layers: a full-screen backdrop, the
  // bubble carrying the button, and an arrow drawn *above* the bubble. Taking
  // only the topmost layer meant landing on the arrow — no buttons, so nothing
  // was dismissed and the backdrop went on swallowing every tap.
  //
  // "No interactive controls at all" is the whole licence to skip a layer. A
  // real dialog that merely lacks a *safe* control still stops the search,
  // exactly as before: descending past it would reach a close button that the
  // dialog is covering, and click it through the dialog.
  var top = null;
  var winner = null;
  for (var ri = 0; ri < ranked.length; ri++) {
    var layer = ranked[ri].root;
    var present = Array.from(layer.querySelectorAll(CONTROLS));
    var controls = present
      .map(function (control, order) { return { control: control, score: score(control), order: order }; })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score || b.order - a.order; });
    if (controls.length) { top = layer; winner = controls[0].control; break; }
    if (present.length) break;
  }
  if (!winner) return null;
  // Read before the click, because the click is what removes it. Dismissing an
  // overlay destroys the evidence of what it said, and a run that then reports
  // "the message never appeared" is describing a page this code emptied. One
  // validation dialog was closed here, three diagnoses were drawn from the
  // resulting blank screen, and all three were wrong.
  var said = norm(top.textContent) || '';
  if (said.length > 120) said = said.slice(0, 120) + '…';
  winner.click();
  return {
    root: top.id ? '#' + top.id : (top.getAttribute('role') || top.tagName.toLowerCase()),
    control: winner.getAttribute('aria-label') || winner.getAttribute('title') ||
      norm(winner.textContent) || String(winner.className || ''),
    text: said,
    source: 'semantic'
  };
})()`;
