/**
 * Converts DOM observation data from WebUiDriver into a UiObservation snapshot.
 *
 * Two components:
 *   1. OBSERVE_DOM_FULL — enhanced inline script (run inside the page via
 *      Playwright's page.evaluate) that captures bounds + enabled state in
 *      addition to what the original OBSERVE_DOM captures.
 *   2. convertDomObservations() — pure conversion function that maps the
 *      raw JS return value into ObservedElement[].
 *
 * The original OBSERVE_DOM in drivers/web.ts is unchanged; this sits alongside
 * it and is used by ElementDiscovery / WebObservationAdapter.
 */

import type { ObservedElement, UiObservation } from './UiObservation.js';

// ── raw shape returned by the in-page script ──────────────────────────────────

export interface DomRawElement {
  testId?: string;
  role?: string;
  name?: string;
  text?: string;
  placeholder?: string;
  css?: string;
  xpath?: string;
  visible: boolean;
  enabled: boolean;
  interactive: boolean;
  checked?: boolean;
  selected?: boolean;
  index: number;
  container: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

// ── conversion ────────────────────────────────────────────────────────────────

/**
 * Map an array of DomRawElement objects (returned by OBSERVE_DOM_FULL) into a
 * full UiObservation.  Pure function — no I/O required.
 */
export function convertDomObservations(
  raw: DomRawElement[],
  context: UiObservation['context'] = {},
): UiObservation {
  const elements: ObservedElement[] = raw.map((r, i) => ({
    id: `web-${i}`,
    role: r.role,
    text: r.text,
    accessibilityLabel: r.name,
    testId: r.testId,
    placeholder: r.placeholder,
    css: r.css,
    xpath: r.xpath,
    bounds: r.bounds,
    visible: r.visible,
    enabled: r.enabled,
    interactive: r.interactive,
    checked: r.checked,
    selected: r.selected,
    index: r.index,
    childIds: r.container ? [] : undefined,
  }));

  return {
    id: `obs-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    platform: 'web',
    source: 'browser',
    context,
    elements,
  };
}

// ── in-page observer script ───────────────────────────────────────────────────

/**
 * Enhanced DOM observer script.  Kept as a string for the same reason as the
 * original OBSERVE_DOM: esbuild would rewrite named inner functions, and
 * Playwright ships the string verbatim into the page.
 *
 * Additions over the original OBSERVE_DOM:
 *   - bounds (getBoundingClientRect)
 *   - enabled (el.disabled)
 *   - checked / selected state
 *   - xpath (simple, not positional)
 */
export const OBSERVE_DOM_FULL = /* js */ `(() => {
  var SEL = [
    'a','button','input','select','textarea',
    '[role]','[data-testid]','[data-test]','[data-cy]',
    'h1','h2','h3','h4','h5','h6',
    'label','[onclick]','[aria-label]'
  ].join(',');

  var seen = {};

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  }

  function cssFor(el) {
    if (el.id) {
      var id = CSS.escape(el.id);
      try { if (document.querySelectorAll('#' + id).length === 1) return '#' + id; } catch(_) {}
    }
    var parts = [], node = el;
    while (node && node !== document.body && parts.length < 5) {
      var tag = node.tagName.toLowerCase();
      var sibs = node.parentElement
        ? Array.prototype.slice.call(node.parentElement.children)
        : [];
      var same = sibs.filter(function(x) { return x.tagName === node.tagName; });
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag);
      node = node.parentElement;
    }
    var sel = parts.join(' > ');
    try { return sel && document.querySelectorAll(sel).length === 1 ? sel : undefined; } catch(_) { return undefined; }
  }

  function xpathFor(el) {
    if (el.id) return '//*[@id=' + JSON.stringify(el.id) + ']';
    var parts = [], node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      var tag = node.tagName.toLowerCase();
      var idx = 1;
      var sib = node.previousElementSibling;
      while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(idx > 1 ? tag + '[' + idx + ']' : tag);
      node = node.parentElement;
    }
    return '//' + parts.join('/');
  }

  var IMPLICIT = {
    a: 'link', button: 'button', input: 'textbox',
    textarea: 'textbox', select: 'combobox'
  };

  return Array.prototype.slice.call(document.querySelectorAll(SEL))
    .filter(visible)
    .map(function(el) {
      var tag = el.tagName.toLowerCase();
      var role = el.getAttribute('role') || IMPLICIT[tag] || tag;
      var n = seen[role] || 0;
      seen[role] = n + 1;
      var text = (el.innerText || '').trim().replace(/\\s+/g, ' ');
      var r = el.getBoundingClientRect();
      return {
        testId: el.getAttribute('data-testid') || el.getAttribute('data-test') ||
                el.getAttribute('data-cy') || undefined,
        role: role,
        name: el.getAttribute('aria-label') || el.getAttribute('title') || undefined,
        text: text && text.length <= 120 ? text : (text ? text.substring(0, 120) : undefined),
        placeholder: el.getAttribute('placeholder') || undefined,
        css: cssFor(el),
        xpath: xpathFor(el),
        visible: true,
        enabled: !el.disabled,
        interactive: /^(a|button|input|select|textarea)$/.test(tag) ||
                     el.hasAttribute('onclick') ||
                     (el.getAttribute('tabindex') !== null && +el.getAttribute('tabindex') >= 0),
        checked: el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : undefined,
        selected: el.tagName === 'OPTION' ? !!el.selected : undefined,
        index: n,
        container: el.children.length > 0,
        bounds: {
          x: Math.round(r.x), y: Math.round(r.y),
          width: Math.round(r.width), height: Math.round(r.height)
        },
      };
    });
})()`;

// ── ObservationProvider factory ───────────────────────────────────────────────

export interface WebPageEvaluator {
  evaluate<T>(script: string): Promise<T>;
  context?: Partial<UiObservation['context']>;
}

/**
 * Creates an ObservationProvider for use with ElementDiscovery from any object
 * that can evaluate a JavaScript expression in the page context (e.g. a
 * Playwright Page instance).
 */
export function createWebObservationProvider(
  page: WebPageEvaluator,
): { observe(): Promise<UiObservation> } {
  return {
    async observe(): Promise<UiObservation> {
      const raw = await page.evaluate<DomRawElement[]>(OBSERVE_DOM_FULL);
      return convertDomObservations(raw, page.context ?? {});
    },
  };
}
