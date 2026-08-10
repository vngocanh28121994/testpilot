/**
 * Converts native UiAutomator2 (Android) or XCUITest (iOS) XML page source
 * into a UiObservation snapshot with full attribute extraction.
 *
 * Improvements over the existing parseUiAutomatorXml in drivers/native.ts:
 *   - extracts bounds, enabled, focused, selected, checked
 *   - preserves parent/child hierarchy via parentId/childIds
 *   - produces ObservedElement[] instead of the simpler Observed[]
 *
 * All parsing functions are pure (no I/O) so they can be unit-tested with
 * fixture XML without any device or driver dependency.
 */

import type { ObservationPlatform, ObservedElement, UiObservation } from './UiObservation.js';

// ── public entry point ────────────────────────────────────────────────────────

/**
 * Build a full UiObservation from raw XML page source.
 * Use `parseAndroidXml` / `parseIosXml` directly when you only need elements.
 */
export function parseNativeObservation(
  xml: string,
  platform: ObservationPlatform,
  context: UiObservation['context'] = {},
): UiObservation {
  const elements =
    platform === 'ios' ? parseIosXml(xml) : parseAndroidXml(xml);

  return {
    id: `obs-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    platform,
    source: 'native',
    context,
    elements,
  };
}

// ── Android / UiAutomator2 ───────────────────────────────────────────────────

/**
 * Parse a UiAutomator2 XML page source into ObservedElements.
 *
 * Attribute mapping:
 *   class          → role
 *   resource-id    → resourceId (last path component after "/")
 *   content-desc   → accessibilityLabel
 *   text           → text
 *   bounds         → bounds  (format: "[x1,y1][x2,y2]")
 *   enabled        → enabled
 *   clickable      → interactive
 *   focused        → focused
 *   selected       → selected
 *   checked        → checked
 *   displayed      → visible  (false only when explicitly "false")
 */
export function parseAndroidXml(xml: string): ObservedElement[] {
  const elements: ObservedElement[] = [];
  const stack: string[] = [];
  const byClass = new Map<string, number>();
  let seq = 0;

  // Match opening <node ...>, self-closing <node .../> and closing </node>
  for (const m of xml.matchAll(/<(\/?)node\b([^>]*?)(\/?)>/g)) {
    const isClose = m[1] === '/';
    const attrs = m[2] ?? '';
    const isSelfClose = m[3] === '/';

    if (isClose) {
      stack.pop();
      continue;
    }

    const get = attr(attrs);
    const cls = get('class');
    if (!cls) continue;

    const n = byClass.get(cls) ?? 0;
    byClass.set(cls, n + 1);

    const id = `n${seq++}`;
    const parentId = stack.length > 0 ? stack[stack.length - 1] : undefined;

    const resourceRaw = get('resource-id');
    const resourceId = resourceRaw
      ? (resourceRaw.split('/').pop() ?? resourceRaw)
      : undefined;

    const el: ObservedElement = {
      id,
      role: cls,
      text: get('text'),
      accessibilityLabel: get('content-desc'),
      resourceId,
      bounds: parseBounds(get('bounds')),
      // UiAutomator2 marks invisible elements with displayed="false"
      visible: get('displayed') !== 'false',
      enabled: get('enabled') !== 'false',
      interactive:
        get('clickable') === 'true' ||
        /EditText|Button|CheckBox|Switch|Spinner|ToggleButton/.test(cls),
      selected: get('selected') === 'true',
      checked: get('checked') === 'true',
      focused: get('focused') === 'true',
      index: n,
      ...(parentId !== undefined ? { parentId } : {}),
      childIds: [],
    };

    linkToParent(elements, parentId, id);
    elements.push(el);

    if (!isSelfClose) stack.push(id);
  }

  return elements;
}

// ── iOS / XCUITest ───────────────────────────────────────────────────────────

const IOS_SKIP_TAGS = new Set(['AppiumAUT', 'XCUIElementTypeOther']);

/**
 * Parse an Appium/XCUITest iOS page source into ObservedElements.
 *
 * Attribute mapping:
 *   type / tag     → role
 *   name           → testId  (XCUITest uses "name" as the stable identifier)
 *   label          → accessibilityLabel
 *   value          → text
 *   enabled        → enabled
 *   visible        → visible
 *   x, y, width, height → bounds
 */
export function parseIosXml(xml: string): ObservedElement[] {
  const elements: ObservedElement[] = [];
  const stack: string[] = [];
  const byType = new Map<string, number>();
  let seq = 0;

  // iOS uses <XCUIElementTypeXxx .../> tags
  for (const m of xml.matchAll(/<(\/?)(\w[\w.]*)\b([^>]*?)(\/?)>/g)) {
    const isClose = m[1] === '/';
    const tagName = m[2]!;
    const attrs = m[3] ?? '';
    const isSelfClose = m[4] === '/';

    if (tagName === '?xml' || tagName === 'AppiumAUT') {
      if (!isClose && !isSelfClose) stack.push('__skip__');
      if (isClose && stack[stack.length - 1] === '__skip__') stack.pop();
      continue;
    }

    if (!tagName.startsWith('XCUI') && tagName !== 'XCUIElementTypeApplication') {
      if (!isClose && !isSelfClose && !IOS_SKIP_TAGS.has(tagName)) continue;
      if (isClose) { stack.pop(); continue; }
      continue;
    }

    if (isClose) {
      stack.pop();
      continue;
    }

    const get = attr(attrs);
    const n = byType.get(tagName) ?? 0;
    byType.set(tagName, n + 1);

    const id = `n${seq++}`;
    const parentId = stack.length > 0 ? stack[stack.length - 1] : undefined;

    const el: ObservedElement = {
      id,
      role: tagName,
      text: get('value'),
      accessibilityLabel: get('label'),
      testId: get('name'),
      bounds: parseIosBounds(get('x'), get('y'), get('width'), get('height')),
      visible: get('visible') !== 'false',
      enabled: get('enabled') !== 'false',
      interactive: isInteractiveIosType(tagName),
      index: n,
      ...(parentId !== undefined ? { parentId } : {}),
      childIds: [],
    };

    linkToParent(elements, parentId, id);
    elements.push(el);

    if (!isSelfClose) stack.push(id);
  }

  return elements;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns a getter for a single XML attribute value from a raw attrs string. */
function attr(attrs: string) {
  return (key: string): string | undefined => {
    const re = new RegExp(`(?:^|\\s)${key}="([^"]*)"`);
    const hit = re.exec(attrs);
    const v = hit?.[1] != null ? unescapeXml(hit[1]) : '';
    return v.trim() || undefined;
  };
}

function parseBounds(s: string | undefined): ObservedElement['bounds'] {
  if (!s) return undefined;
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(s);
  if (!m) return undefined;
  const [x1, y1, x2, y2] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!];
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function parseIosBounds(
  x?: string,
  y?: string,
  w?: string,
  h?: string,
): ObservedElement['bounds'] {
  if (!x || !y || !w || !h) return undefined;
  return { x: +x, y: +y, width: +w, height: +h };
}

function isInteractiveIosType(type: string): boolean {
  return /Button|TextField|SecureTextField|Picker|Switch|Slider|Stepper|SegmentedControl|SearchField|DatePicker/.test(
    type,
  );
}

function linkToParent(
  elements: ObservedElement[],
  parentId: string | undefined,
  childId: string,
): void {
  if (parentId === undefined) return;
  const parent = elements.find((e) => e.id === parentId);
  if (parent) {
    (parent.childIds ??= []).push(childId);
  }
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ── ObservationProvider factory ───────────────────────────────────────────────

export interface NativePageSourceProvider {
  platform: 'android' | 'ios';
  context?: Partial<UiObservation['context']>;
  getPageSource(): Promise<string>;
}

/**
 * Creates an ObservationProvider for use with ElementDiscovery from any object
 * that can supply raw UiAutomator2 / XCUITest XML.
 *
 * Usage with NativeUiDriver (after adding a public getPageSource() method):
 *   const provider = createNativeObservationProvider(nativeDriver);
 */
export function createNativeObservationProvider(
  source: NativePageSourceProvider,
): { observe(): Promise<UiObservation> } {
  return {
    async observe(): Promise<UiObservation> {
      const xml = await source.getPageSource();
      return parseNativeObservation(xml, source.platform, source.context ?? {});
    },
  };
}
