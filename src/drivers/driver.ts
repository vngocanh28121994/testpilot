import type { Observed } from '../crawl/observe.js';
import type { ControlType, LocatorCandidate, Platform } from '../core/types.js';

export interface ControlInspection {
  type: ControlType;
  /** Runtime facts used for the classification; never includes field values. */
  evidence: string[];
}

/** Aggregate evidence for business assertions about a list/result set. */
export interface UiMatchSnapshot {
  count: number;
  texts: string[];
  /** Zero-based indexes whose DOM/native control currently owns focus/selection. */
  focused: number[];
}

/**
 * A handle to something the driver found *right now*. Handles are deliberately
 * short-lived: the resolver re-finds before every action, which is what makes
 * the suite tolerant of re-renders (Maestro's core trick — no stale references).
 */
export interface UiHandle {
  readonly candidate: LocatorCandidate;
  isVisible(): Promise<boolean>;
  text(): Promise<string>;
  /**
   * What the field currently holds, or null when it is not a field at all.
   *
   * Distinct from `text()`: on the web a text input's textContent is always
   * empty, and on a device the entered text and the visible label are different
   * things. Optional because a driver that cannot read a value should make the
   * executor skip verification rather than invent one.
   */
  value?(): Promise<string | null>;
  /** Selected/active state for tabs, options, radios and similar controls. */
  selected?(): Promise<boolean | undefined>;
  /**
   * What the control is *called*, as opposed to what it currently holds.
   *
   * For a combobox, a select or a text field these are different strings and
   * only one of them identifies the element: `text()` on `<mat-select>` returns
   * "TK Thường", the chosen account, while the thing that says which control it
   * is — "Chuyển từ" — lives in a separate label node the element points at.
   * Verifying a form control against its own value therefore rejects the right
   * element, which is exactly what it did on the mobile web build.
   *
   * Optional for the same reason as `value()`: a driver that cannot compute an
   * accessible name should return nothing rather than guess, and callers must
   * fall back to `text()`.
   */
  accessibleName?(): Promise<string | undefined>;
}

/**
 * Every driver primitive is a single, non-retrying operation. Waiting, retrying
 * and candidate fallback are implemented once in runtime/resolver.ts so that web
 * and native behave identically. Drivers must not add their own implicit waits.
 */
export interface UiDriver {
  /** Stable platform selected for the run/report (unlike `platform`, which may
   * temporarily become `web` while a native app is inside a WebView). */
  readonly runPlatform?: Platform;
  readonly platform: Platform;
  readonly device: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Open the app / navigate to the entry point. */
  launch(target?: string): Promise<void>;

  /** One-shot lookup. Returns null when not found — never throws for "not found". */
  find(candidate: LocatorCandidate): Promise<UiHandle | null>;

  /** Inspect all visible matches for count/order/dedup/focus assertions. */
  inspectMatches?(candidate: LocatorCandidate): Promise<UiMatchSnapshot>;

  tap(handle: UiHandle): Promise<void>;
  /** Optional because native-only engines cannot represent pointer hover. */
  hover?(handle: UiHandle): Promise<void>;
  /** Drag source to target; unsupported engines must leave this undefined. */
  dragDrop?(source: UiHandle, target: UiHandle): Promise<void>;
  longPress(handle: UiHandle, ms: number): Promise<void>;
  /** `typeDelay` is ms between keystrokes; omit for atomic fill. */
  input(handle: UiHandle, text: string, typeDelay?: number): Promise<void>;
  /** Select/set a calendar date and verify the field accepted it. */
  selectDate?(handle: UiHandle, date: string): Promise<void>;
  /** Inspect the exact resolved control before choosing an action capability. */
  inspectControl?(handle: UiHandle): Promise<ControlInspection>;
  /**
   * The value belonging to a caption, when the handle turned out to be the
   * caption itself.
   *
   * Confirmation screens are built as two columns: "Lệnh" on the left and
   * "Chuyển tiền" on the right, as plain divs. A step reading
   * `"Lệnh" shows "Chuyển tiền"` means the field named Lệnh, but the locator
   * matches the text Lệnh — so the assertion compares the caption against the
   * value and fails on every row of every confirmation screen in the app.
   *
   * Deliberately not part of locating. A button whose text is "Lệnh" is itself
   * the thing the step meant, and rewriting the locator would break it; only an
   * assertion that has already found the caption unhelpful may ask for this.
   */
  captionValue?(handle: UiHandle): Promise<string | undefined>;
  clear(handle: UiHandle): Promise<void>;
  selectOption(handle: UiHandle, option: string): Promise<void>;
  scrollIntoView(handle: UiHandle): Promise<void>;

  swipe(direction: 'left' | 'right' | 'up' | 'down'): Promise<void>;
  scroll(direction: 'up' | 'down'): Promise<void>;
  back(): Promise<void>;

  /** Returns a file path. */
  screenshot(name: string): Promise<string>;

  /**
   * Dumps the UI tree next to the failure screenshot: the accessibility tree on
   * native, the DOM on web. A screenshot shows that a locator missed; only the
   * tree shows *what was actually there* to match against — which is the
   * difference between fixing a locator and guessing at one, and on a device
   * farm every guess costs a paid run.
   */
  dumpTree?(name: string): Promise<string | undefined>;

  /**
   * Scenario boundary hooks, both optional. Playwright records one video per
   * page, so the web driver rotates the page here to get one video per
   * scenario instead of a single unusable recording of the whole run.
   * `endScenario` returns the video path when there is one.
   */
  beginScenario?(scenarioId: string): Promise<void>;
  endScenario?(scenarioId: string): Promise<string | undefined>;

  /**
   * Local authenticated-session fixture. Implementations must treat the state
   * as a secret: never log it, attach it to reports, or upload it to a farm.
   * Returning true only means state was loaded; the business flow still
   * validates the logged-in UI before trusting it.
   */
  restoreAuthenticatedSession?(key: string): Promise<boolean>;
  saveAuthenticatedSession?(key: string): Promise<void>;
  invalidateAuthenticatedSession?(key: string): Promise<void>;

  /**
   * Everything addressable on the current screen.
   *
   * `find` answers "where is this one thing"; this answers "what is here at
   * all", which is what the crawler needs to build a registry from the real app
   * instead of from a description of it.
   */
  observe?(): Promise<Observed[]>;

  /** Read-only accessibility evidence from Playwright MCP browser_snapshot. */
  observeAccessibility?(): Promise<Observed[]>;

  /**
   * True when the UI has settled (no network in flight / no animation).
   * The resolver polls this before declaring a lookup failed, which removes the
   * single largest source of flake: asserting against a mid-transition screen.
   */
  isIdle(): Promise<boolean>;

  /**
   * Dismiss a native overlay (permission dialog, system popup) that is blocking
   * the UI under test. Returns true when something was dismissed so the caller
   * can retry immediately instead of burning the poll interval.
   *
   * `protect` names CSS selectors the caller is currently searching for. A
   * layer containing one of them is left alone: the overlay in the way and the
   * element being waited for are sometimes the same dialog.
   */
  dismissOverlay?(protect?: string[]): Promise<boolean>;

  /**
   * Current URL of the web context (pathname + hash). Used by the resolver to
   * detect when the app has navigated to an unexpected screen. Native drivers
   * that have no concept of URL leave this undefined.
   */
  currentUrl?(): Promise<string>;
}

/**
 * Tells the popup interceptor which layer to spare, derived from the element
 * the current step already names.
 *
 * Overlay clearing and element lookup are the same operation seen from two
 * sides: an app that reports a failed login inside a dialog makes that dialog
 * both the thing in the way and the thing being asserted on. Without this, the
 * search closed what it was about to find.
 *
 * Entries are CSS selectors, or `text=<visible text>` for the strategies that
 * have no CSS equivalent. Text matters because most authored elements are
 * labels: restricting protection to CSS meant the common case — an element
 * inside a dialog, written as its visible text — was not protected at all.
 *
 * Over-protecting would leave real overlays on screen, which is the failure the
 * interceptor exists to prevent. Two things keep that in check: the text match
 * is exact rather than partial, so a short label like "OK" cannot shield every
 * dialog on the page; and a noise popup that genuinely contains the wanted text
 * is one the lookup would have resolved against anyway, so the interceptor is
 * never reached.
 */
export function protectedSelectors(candidates: LocatorCandidate[]): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.value.trim();
    if (!value) continue;
    switch (candidate.strategy) {
      case 'css':
        out.push(value);
        break;
      case 'role':
        out.push(`[role="${value}"]`);
        if (value === 'dialog') out.push('mat-dialog-container', '[aria-modal="true"]');
        if (candidate.name) out.push(`text=${candidate.name.trim()}`);
        break;
      case 'testId':
        out.push(`[data-testid="${value}"]`);
        break;
      case 'placeholder':
        out.push(`[placeholder="${value}"]`);
        break;
      case 'label':
        out.push(`text=${value}`);
        break;
      default:
        // xpath, relative and predicate have no cheap in-page equivalent.
        break;
    }
  }
  return [...new Set(out)];
}
