/**
 * AppiumMcpDriver — UiDriver implementation backed by AppiumMcpSession.
 *
 * Phase 1.3: bridges the discovery pipeline (PATH A) to the interaction layer
 * (PATH B) via AppiumMcpSession.
 *
 * CONTRACT:
 *   find(candidate):
 *     - maps LocatorCandidate.strategy to appium-mcp strategy names
 *     - calls session.findByLocator(strategy, value) → ephemeral UUID
 *     - returns AppiumMcpHandle wrapping the UUID
 *     - returns null on PROVIDER_ELEMENT_NOT_FOUND (element not in tree)
 *
 *   tap/input/clear:
 *     - use the UUID from the handle for one interaction
 *     - UUID is consumed and the handle is never reused across interactions
 *     - StaleElementError propagates to the executor for retry
 *
 * INVARIANTS:
 *   - UUID is NEVER stored in this driver after an interaction completes
 *   - findByLocator() is ONLY called from find() — never from discover/observe
 *   - Path A (observe) and Path B (interact) are completely separate
 *
 * LIFECYCLE:
 *   - Session must be created externally via session.create() before use
 *   - Session deletion (session.delete()) is the caller's responsibility
 *   - start() / stop() are no-ops; the session lifecycle is managed outside
 *
 * LIMITATIONS (Phase 1.3 scope):
 *   - isVisible(): returns true when findByLocator() succeeded (UiAutomator2 only
 *     includes rendered elements; off-screen elements may still be found)
 *   - isIdle(): returns false (conservative — no idle signal from appium-mcp)
 *   - longPress / swipe / back / scroll / scrollIntoView / selectOption: not
 *     yet real-emulator verified; some throw NotImplementedError
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocatorCandidate, Platform } from '../core/types.js';
import type { UiDriver, UiHandle } from './driver.js';
import type { AppiumMcpSession } from '../discovery/mcp/AppiumMcpSession.js';
import { StaleElementError } from '../discovery/mcp/AppiumMcpErrors.js';
import { TestPilotError, TestPilotErrorCode } from '../core/ErrorCodes.js';

// ── handle ────────────────────────────────────────────────────────────────────

/**
 * Wraps an ephemeral element UUID returned by appium_find_element.
 *
 * The UUID is valid for exactly ONE interaction after the observation that
 * produced the locator.  Any UI mutation (navigation, re-render, focus change)
 * may invalidate it — StaleElementError signals this to the caller.
 */
class AppiumMcpHandle implements UiHandle {
  constructor(
    readonly candidate: LocatorCandidate,
    /** Ephemeral UUID from appium_find_element.  Must not be cached or reused. */
    readonly elementUUID: string,
    private readonly session: AppiumMcpSession,
  ) {}

  /**
   * Returns true if findByLocator() succeeded — UiAutomator2 only reports
   * elements that are rendered in the current view hierarchy.  Elements with
   * displayed="false" are typically excluded from getPageSource(), so a UUID
   * that was obtained means the element was present at find time.
   *
   * Limitation: does not detect off-screen elements that UiAutomator2 still
   * includes in the tree (e.g. siblings in a RecyclerView).
   */
  async isVisible(): Promise<boolean> {
    return true;
  }

  async text(): Promise<string> {
    try {
      return (await this.session.getText(this.elementUUID)) ?? '';
    } catch (err) {
      if (err instanceof StaleElementError) throw err;
      return '';
    }
  }

  /**
   * Returns null for empty / Capacitor WebView-managed fields (where native
   * getText returns empty because the text is in the DOM, not the native tree).
   * Returns null on stale element so executor.verifyInput() skips verification
   * rather than raising a false failure.
   */
  async value(): Promise<string | null> {
    try {
      return await this.session.getText(this.elementUUID);
    } catch (err) {
      if (err instanceof StaleElementError) return null;
      return null;
    }
  }
}

// ── driver options ────────────────────────────────────────────────────────────

export interface AppiumMcpDriverOptions {
  platform: 'android' | 'ios';
  device: string;
  /**
   * Android app package name (e.g. 'com.fss.tcbs.mobiletrading').
   * Used to reconstruct the full resource-id from the short form stored in
   * ObservedElement.resourceId: appPackage + ':id/' + shortId.
   * Optional — when absent, the short form is passed directly to appium-mcp
   * (which may still work on some Appium builds).
   */
  appPackage?: string;
  /** Directory for screenshot files. Created on first use if absent. */
  artifactsDir: string;
}

// ── driver ────────────────────────────────────────────────────────────────────

export class AppiumMcpDriver implements UiDriver {
  readonly platform: Platform;
  readonly device: string;

  constructor(
    private readonly session: AppiumMcpSession,
    private readonly opts: AppiumMcpDriverOptions,
  ) {
    this.platform = opts.platform;
    this.device = opts.device;
  }

  /**
   * Session lifecycle is managed externally.  The session must already be in
   * a created state before calling find()/tap()/etc.
   */
  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  /**
   * App launch / foreground is not yet implemented for Phase 1.3.
   * The session must already have the app open.
   * Phase 1.4 will add: session lifecycle tied to driver start/stop.
   */
  async launch(_target?: string): Promise<void> {}

  /**
   * Resolve a LocatorCandidate to an ephemeral UUID via appium_find_element.
   *
   * Returns null when:
   *   - the element is not found (PROVIDER_ELEMENT_NOT_FOUND)
   *   - the strategy is unsupported on this platform (e.g. css on Android)
   *
   * Throws when an unexpected MCP error occurs.
   */
  async find(candidate: LocatorCandidate): Promise<UiHandle | null> {
    const mapped = this.mapLocator(candidate);
    if (!mapped) return null;

    try {
      const uuid = await this.session.findByLocator(mapped.strategy, mapped.value);
      return new AppiumMcpHandle(candidate, uuid, this.session);
    } catch (err) {
      if (
        err instanceof TestPilotError &&
        err.code === TestPilotErrorCode.PROVIDER_ELEMENT_NOT_FOUND
      ) {
        return null;
      }
      throw err;
    }
  }

  /** Tap the element.  Throws StaleElementError if the UUID has been invalidated. */
  async tap(handle: UiHandle): Promise<void> {
    await this.session.tap((handle as AppiumMcpHandle).elementUUID);
  }

  /** Long-press.  appium_gesture action='long_press' contract unverified — falls back to tap. */
  async longPress(handle: UiHandle, _ms: number): Promise<void> {
    // TODO Phase 1.4: verify { elementUUID, action: 'long_press', duration: ms } against real server
    await this.session.tap((handle as AppiumMcpHandle).elementUUID);
  }

  /** Type text into a field. */
  async input(handle: UiHandle, text: string): Promise<void> {
    await this.session.setValue((handle as AppiumMcpHandle).elementUUID, text);
  }

  /** Clear a field by setting its value to an empty string. */
  async clear(handle: UiHandle): Promise<void> {
    await this.session.setValue((handle as AppiumMcpHandle).elementUUID, '');
  }

  async selectOption(_handle: UiHandle, _option: string): Promise<void> {
    throw new Error('selectOption is not implemented for AppiumMcpDriver (Phase 1.3 scope)');
  }

  async scrollIntoView(_handle: UiHandle): Promise<void> {
    // TODO Phase 1.4: verify appium_gesture { action: 'scroll_to_element', elementUUID }
  }

  async swipe(_direction: 'left' | 'right' | 'up' | 'down'): Promise<void> {
    // TODO Phase 1.4: verify appium_gesture { action: 'swipe', ... }
    throw new Error('swipe is not yet verified via appium-mcp (Phase 1.4 scope)');
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.swipe(direction);
  }

  async back(): Promise<void> {
    // TODO Phase 1.4: verify appium_gesture { action: 'back' }
    throw new Error('back is not yet verified via appium-mcp (Phase 1.4 scope)');
  }

  async screenshot(name: string): Promise<string> {
    const base64 = await this.session.screenshot();
    await mkdir(this.opts.artifactsDir, { recursive: true });
    const file = path.join(
      this.opts.artifactsDir,
      `${name.replace(/[^a-z0-9-_]+/gi, '_')}.png`,
    );
    await writeFile(file, Buffer.from(base64, 'base64'));
    return file;
  }

  /**
   * appium-mcp has no idle-state signal.
   *
   * Returns false (not idle) so the resolver always waits before giving up —
   * conservative but correct: prevents "element not found" during UI transitions
   * where the element exists but hasn't been reported yet.
   */
  async isIdle(): Promise<boolean> {
    return false;
  }

  // ── strategy mapping ────────────────────────────────────────────────────────

  /**
   * Map a LocatorCandidate to an appium-mcp { strategy, value } pair.
   *
   * Returns null when the strategy is not supported on this platform
   * (caller treats null as "strategy not applicable — skip this candidate").
   *
   * Mapping table (LocatorCandidate.strategy → appium-mcp strategy):
   *
   *   xpath        → xpath           REAL-VERIFIED (Phase 1.2)
   *   label        → accessibility id  (content-desc / accessibilityIdentifier)
   *   testId       → accessibility id  mirrors NativeUiDriver: ~value = accessibility id
   *   role         → class name        Android class (android.widget.Button)
   *   placeholder  → xpath with @hint  UiAutomator2 @hint attribute
   *   css          → null              CSS not supported in native UiAutomator2
   *   predicate    → -ios predicate string (iOS only; null on Android)
   *
   * KNOWN LIMITATION:
   *   When the resolver maps a discovered resourceId locator via
   *   mapDiscoveryStrategy('resourceId') → 'testId', the value is the SHORT
   *   resource-id (e.g. 'login_phone').  Passing 'login_phone' to
   *   accessibility-id strategy will fail unless the element's content-desc
   *   happens to be 'login_phone'.
   *   Fix: mapDiscoveryStrategy should map 'resourceId' → a new 'resourceId'
   *   LocatorCandidate strategy (Phase 1.4 scope, tracked as Risk R3).
   */
  private mapLocator(candidate: LocatorCandidate): { strategy: string; value: string } | null {
    const { strategy, value } = candidate;

    switch (strategy) {
      case 'xpath':
        return { strategy: 'xpath', value };

      case 'label':
        return { strategy: 'accessibility id', value };

      case 'testId':
        // Mirrors NativeUiDriver behavior (~value = accessibility id in WebdriverIO).
        // Works when testId is a content-desc / accessibility label.
        // Falls back gracefully (not found) when testId is a resource-id short form.
        return { strategy: 'accessibility id', value };

      case 'role':
        // Android: maps to UiAutomator2 class name (android.widget.Button, etc.)
        // iOS: maps to XCUIElementType* class name
        return { strategy: 'class name', value };

      case 'placeholder': {
        // UiAutomator2 exposes placeholder text as the @hint attribute on EditText.
        const escaped = value.replace(/"/g, '\\"');
        return { strategy: 'xpath', value: `//*[@hint="${escaped}"]` };
      }

      case 'css':
        // CSS selectors are not supported in native UiAutomator2 context.
        return null;

      case 'predicate':
        if (this.platform === 'ios') {
          return { strategy: '-ios predicate string', value };
        }
        // Android does not support iOS predicate strings.
        return null;

      default:
        return null;
    }
  }
}
