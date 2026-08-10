import type { Observed } from '../crawl/observe.js';
import type { LocatorCandidate, Platform } from '../core/types.js';

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
}

/**
 * Every driver primitive is a single, non-retrying operation. Waiting, retrying
 * and candidate fallback are implemented once in runtime/resolver.ts so that web
 * and native behave identically. Drivers must not add their own implicit waits.
 */
export interface UiDriver {
  readonly platform: Platform;
  readonly device: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Open the app / navigate to the entry point. */
  launch(target?: string): Promise<void>;

  /** One-shot lookup. Returns null when not found — never throws for "not found". */
  find(candidate: LocatorCandidate): Promise<UiHandle | null>;

  tap(handle: UiHandle): Promise<void>;
  longPress(handle: UiHandle, ms: number): Promise<void>;
  input(handle: UiHandle, text: string): Promise<void>;
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
   * Everything addressable on the current screen.
   *
   * `find` answers "where is this one thing"; this answers "what is here at
   * all", which is what the crawler needs to build a registry from the real app
   * instead of from a description of it.
   */
  observe?(): Promise<Observed[]>;

  /**
   * True when the UI has settled (no network in flight / no animation).
   * The resolver polls this before declaring a lookup failed, which removes the
   * single largest source of flake: asserting against a mid-transition screen.
   */
  isIdle(): Promise<boolean>;
}
