import type { ElementDef, LocatorCandidate, Platform } from '../core/types.js';

/**
 * What a driver saw on screen, before any judgement about how to address it.
 *
 * This is deliberately a flat record of raw attributes rather than a locator:
 * the whole point of the crawler is that ranking happens once, here, from real
 * observations — instead of an LLM guessing selectors from prose, or a person
 * writing `instance(1)` and finding out on a paid device that it meant the
 * wrong field.
 */
export interface Observed {
  /** data-testid / resource-id — whatever the app exposes as a stable handle. */
  testId?: string;
  /** ARIA role on web, widget class on native. */
  role?: string;
  /** Accessible name: aria-label, content-desc, or the label bound to a field. */
  name?: string;
  /** Visible text, trimmed. */
  text?: string;
  placeholder?: string;
  /** Android resource-id, already stripped of its package prefix. */
  resourceId?: string;
  /** CSS selector the driver believes is unique. Web only. */
  css?: string;
  /** True when the user can act on it: button, link, input, clickable node. */
  interactive: boolean;
  /** Position among same-role siblings. The fallback of last resort. */
  index: number;
  /**
   * Whether this node has children. A node that wraps other nodes carries their
   * concatenated text, so matching it by text matches the whole subtree — the
   * trap that made a button tap land in the middle of the page.
   */
  container: boolean;
}

/**
 * Weights encode how long a locator survives, not how convenient it is today.
 *
 * A test id is written to be addressed and changes only deliberately. Visible
 * text changes whenever copy or translation changes. Position changes whenever
 * anyone adds a field. Ordering candidates by this is what lets the resolver
 * heal downward instead of failing, and what makes the report's "your best
 * locator is a position" warning meaningful.
 */
const WEIGHT = {
  testId: 0.95,
  resourceId: 0.9,
  roleAndName: 0.8,
  placeholder: 0.78,
  exactText: 0.7,
  /** `#id` is written once and addressed forever. */
  cssId: 0.85,
  /** A structural `div > div:nth-of-type(2)` path breaks the next time anyone
   *  wraps something in a container. It is a locator of last resort that only
   *  looks respectable. */
  cssPath: 0.35,
  index: 0.3,
} as const;

/** Below this, a locator is a stopgap rather than something to rely on. */
export const FRAGILE_BELOW = 0.5;

/**
 * Icon fonts render their glyph name as text — `vpn_key`, `arrow_back`. Treating
 * that as a label produces elements nobody wrote and locators that break the
 * moment the icon changes, so the text is dropped and the node keeps whatever
 * real handle it has.
 */
export function isIconLigature(text: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+){0,3}$/.test(text) && !text.includes(' ');
}

/**
 * Turns one observation into an ordered candidate list.
 *
 * Container nodes never get a text candidate: their text is everything inside
 * them, so it matches far more than intended and the tap lands at the centre of
 * the whole subtree.
 */
export function candidatesFor(o: Observed, platform: Platform): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  const add = (
    strategy: LocatorCandidate['strategy'],
    value: string,
    weight: number,
    name?: string,
  ) => out.push({ strategy, value, weight, origin: 'crawler', ...(name ? { name } : {}) });

  if (o.testId) add('testId', o.testId, WEIGHT.testId);
  if (o.resourceId && platform !== 'web') {
    add('predicate', `new UiSelector().resourceId("${o.resourceId}")`, WEIGHT.resourceId);
  }
  if (o.role && o.name) add('role', o.role, WEIGHT.roleAndName, o.name);
  if (o.placeholder) add('placeholder', o.placeholder, WEIGHT.placeholder);
  if (o.text && !o.container && !isIconLigature(o.text)) add('label', o.text, WEIGHT.exactText);
  if (o.css && platform === 'web') {
    add('css', o.css, o.css.startsWith('#') ? WEIGHT.cssId : WEIGHT.cssPath);
  }

  // Position is emitted only when nothing better exists, and only for native,
  // where an unlabelled EditText genuinely has no other handle. On web there is
  // always a CSS path, so falling back to an index there would hide a problem
  // rather than solve one.
  if (out.length === 0 && platform !== 'web' && o.role) {
    add(
      'predicate',
      `new UiSelector().className("${o.role}").instance(${o.index})`,
      WEIGHT.index,
    );
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * A readable, stable id for an element: `screen.thingName`.
 *
 * Derived from what the element *is*, so re-crawling the same screen produces
 * the same id and the merge updates an entry instead of duplicating it.
 */
export function elementId(screen: string, o: Observed): string {
  const base =
    o.testId ??
    o.resourceId ??
    o.name ??
    o.placeholder ??
    o.text ??
    `${o.role ?? 'node'}${o.index}`;
  return `${screen}.${camel(base)}`;
}

/** Human-facing label used in generated Gherkin and in the report. */
export function elementLabel(o: Observed): string {
  return (o.name ?? o.text ?? o.placeholder ?? o.testId ?? o.resourceId ?? o.role ?? 'element')
    .trim()
    .slice(0, 60);
}

export function toElementDef(screen: string, o: Observed, platform: Platform): ElementDef {
  return {
    id: elementId(screen, o),
    label: elementLabel(o),
    screen,
    candidates: { [platform]: candidatesFor(o, platform) },
  };
}

/** `Số tài khoản` -> `soTaiKhoan`; keeps ids readable and ASCII. */
function camel(s: string): string {
  const words = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 5);
  if (words.length === 0) return 'element';
  return (
    words[0]!.toLowerCase() +
    words
      .slice(1)
      .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  );
}
