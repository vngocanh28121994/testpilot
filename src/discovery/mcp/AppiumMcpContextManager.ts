/**
 * AppiumMcpContextManager — enforces the NATIVE_APP vs WEBVIEW fallback policy
 * for Capacitor/Ionic hybrid apps.
 *
 * PREREQUISITE — WebView debugging must be enabled in the app (verified 2026-08-12):
 *   WebView context switching requires the app to call
 *   `WebView.setWebContentsDebuggingEnabled(true)` so Chromedriver can attach.
 *   Without it, `appium_get_page_source` falls back to UiAutomator2 native XML
 *   even after `appium_context switch` → WEBVIEW, and CSS selectors fail.
 *
 *   The TCBS production build does NOT enable WebView debugging.  On a debug
 *   build with WebContentsDebuggingEnabled=true:
 *     - getPageSource() in WEBVIEW context → real HTML DOM
 *     - findByLocator('css selector', ...) → works via Chromedriver
 *     - parseWebViewHtml() below becomes reachable
 *
 *   Workaround for production build: use UiAutomator2 xpath in NATIVE_APP context
 *   (e.g. //android.widget.EditText) — UiAutomator2 includes WebView-hosted
 *   elements in the native hierarchy regardless of WebView debugging state.
 *
 * Policy (strictly enforced):
 *   1. Always ensure NATIVE_APP context first.
 *   2. Get page source and parse it.
 *   3. If hybrid=false → return NATIVE_APP observation.
 *   4. If hybrid=true AND native has ≥1 interactive element → return NATIVE_APP observation.
 *   5. If hybrid=true AND native has 0 interactive elements:
 *        switch to WEBVIEW_com.fss.tcbs.mobiletrading
 *        get page source (returns native XML via appium-mcp — NOT HTML)
 *        parse HTML (dead code for appium-mcp — parseWebViewHtml receives native XML)
 *        ALWAYS restore NATIVE_APP in finally
 *        return WEBVIEW observation (will have 0 elements for appium-mcp)
 *   6. If WebView switch/observation fails: restore NATIVE_APP in finally, rethrow.
 *
 * "Interactive" follows the existing ObservedElement.interactive semantics from
 * NativeObservationAdapter — no additional attribute counting or regex.
 */

import { parseNativeObservation } from '../NativeObservationAdapter.js';
import type { AppiumMcpSession } from './AppiumMcpSession.js';
import type { ObservedElement, UiObservation } from '../UiObservation.js';

const WEBVIEW_CONTEXT = 'WEBVIEW_com.fss.tcbs.mobiletrading';

export interface ObservationWithContext {
  observation: UiObservation;
  /** Which Appium context the page source was captured from. */
  usedContext: 'NATIVE_APP' | 'WEBVIEW';
}

export class AppiumMcpContextManager {
  constructor(
    private readonly session: AppiumMcpSession,
    private readonly hybrid: boolean,
    /** Platform used for NativeObservationAdapter when parsing native XML. */
    private readonly platform: 'android' | 'ios' = 'android',
  ) {}

  /**
   * Observe the UI with WebView fallback for hybrid apps.
   *
   * Always starts in NATIVE_APP.
   * Switches to WEBVIEW only when hybrid=true and native has no interactive elements.
   * Restores NATIVE_APP in a finally block — even if the WebView observation fails.
   *
   * NOTE (Phase W1): For the production run.ts flow, WebView observation is now handled
   * by WebViewCdpDriver (src/drivers/WebViewCdpDriver.ts), which connects via
   * chromium.connectOverCDP() and sees the full Angular DOM (formcontrolname,
   * data-testid, aria-label) that this appium-mcp path cannot reach.
   * For the Appium-MCP path specifically, the correct fix would be to inject a
   * WebViewCdpDriver instance here rather than relying on appium_get_page_source,
   * which always returns UiAutomator2 native XML even in WEBVIEW context.
   */
  async observeWithFallback(): Promise<ObservationWithContext> {
    // Step 1: ensure NATIVE_APP context.
    await this.session.switchContext('NATIVE_APP');

    // Step 2: observe native.
    const nativeXml = await this.session.getPageSource();
    const nativeObs = parseNativeObservation(nativeXml, this.platform, {
      webContext: 'NATIVE_APP',
    });

    // Step 3: non-hybrid apps → always return native.
    if (!this.hybrid) {
      return { observation: nativeObs, usedContext: 'NATIVE_APP' };
    }

    // Step 4: hybrid, native has interactive elements → return native.
    const hasInteractive = nativeObs.elements.some(isInteractive);
    if (hasInteractive) {
      return { observation: nativeObs, usedContext: 'NATIVE_APP' };
    }

    // Step 5: hybrid, native has no interactive elements → WebView fallback.
    try {
      await this.session.switchContext(WEBVIEW_CONTEXT);
      const html = await this.session.getPageSource();
      const webObs = parseWebViewHtml(html, WEBVIEW_CONTEXT);
      return { observation: webObs, usedContext: 'WEBVIEW' };
    } finally {
      // Step 6: always restore NATIVE_APP, even if WebView observation failed.
      await this.session.switchContext('NATIVE_APP').catch(() => undefined);
    }
  }
}

// ── interactability check ─────────────────────────────────────────────────────

function isInteractive(el: ObservedElement): boolean {
  return el.interactive === true && el.visible !== false && el.enabled !== false;
}

// ── minimal WebView HTML parser ───────────────────────────────────────────────

/**
 * Extract interactive elements from a Capacitor/Ionic WebView HTML page source.
 *
 * NOTE: This function is NOT REACHABLE via appium-mcp because appium_get_page_source
 * always returns UiAutomator2 native XML even in WEBVIEW context.  It would only
 * work with a Chromedriver-backed MCP that returns true HTML in WebView context.
 *
 * This is an intentionally minimal parser — it covers the element types and
 * attributes that Ionic/Angular/Capacitor apps expose.  It does NOT attempt to
 * replicate NativeObservationAdapter; it produces UiObservation.elements that
 * follow the same ObservedElement contract.
 *
 * Interactive element tags (Ionic + standard HTML):
 *   button, a, input, select, textarea
 *   ion-button, ion-input, ion-select, ion-checkbox, ion-radio,
 *   ion-toggle, ion-item, ion-searchbar, ion-fab-button
 */
function parseWebViewHtml(html: string, contextName: string): UiObservation {
  const elements: ObservedElement[] = [];
  let seq = 0;

  // Single-pass regex over opening tags (including self-closing).
  // We don't need a full DOM — we only care about element attributes.
  for (const m of html.matchAll(/<([\w-]+)([^>]*?)(?:\/?>)/gi)) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2] ?? '';

    if (!isInteractiveHtmlTag(tag)) continue;

    const disabled = /(?:^|\s)disabled(?:\s|=|$)/i.test(attrs);
    const id = htmlAttr(attrs, 'id');
    const testId = htmlAttr(attrs, 'data-testid') ?? htmlAttr(attrs, 'data-cy');
    const ariaLabel = htmlAttr(attrs, 'aria-label');
    const placeholder = htmlAttr(attrs, 'placeholder');
    const value = htmlAttr(attrs, 'value');
    const name = htmlAttr(attrs, 'name');

    const el: ObservedElement = {
      id: `hw${seq++}`,
      role: tag,
      text: value,
      accessibilityLabel: ariaLabel,
      resourceId: id ?? name,
      testId,
      placeholder,
      visible: true,
      enabled: !disabled,
      interactive: !disabled,
    };

    elements.push(el);
  }

  return {
    id: `obs-wv-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    platform: 'web',
    source: 'webview',
    context: { webContext: contextName },
    elements,
  };
}

const INTERACTIVE_TAGS = new Set([
  'button', 'a', 'input', 'select', 'textarea',
  'ion-button', 'ion-input', 'ion-select', 'ion-checkbox',
  'ion-radio', 'ion-toggle', 'ion-item', 'ion-searchbar',
  'ion-fab-button',
]);

function isInteractiveHtmlTag(tag: string): boolean {
  return INTERACTIVE_TAGS.has(tag);
}

function htmlAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i');
  const m = re.exec(attrs);
  const v = m?.[1];
  return v !== undefined && v.length > 0 ? v : undefined;
}
