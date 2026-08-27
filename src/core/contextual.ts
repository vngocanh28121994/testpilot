/** Semantic row-relative controls authored in natural-language scenarios. */
import { ROW_CLASS_TOKENS } from './rows.js';
import type { LocatorCandidate } from './types.js';

export interface ContextualRowAction {
  action: string;
  rowText: string;
}

export type RelativeRowMode = 'metadata' | 'accessible' | 'actions' | 'last';

export interface RelativeRowLocator {
  rowText: string;
  action: string;
  mode: RelativeRowMode;
}

/** Compact, readable registry representation; execution stays Playwright-native. */
export function formatRelativeRowLocator(spec: RelativeRowLocator): string {
  return `row(${JSON.stringify(spec.rowText)}) >> ${JSON.stringify(spec.action)}:${spec.mode}`;
}

export function parseRelativeRowLocator(value: string): RelativeRowLocator | undefined {
  const match = /^row\(("(?:[^"\\]|\\.)*")\)\s*>>\s*("(?:[^"\\]|\\.)*"):(metadata|accessible|actions|last)$/u.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  try {
    return {
      rowText: JSON.parse(match[1]) as string,
      action: JSON.parse(match[2]) as string,
      mode: match[3] as RelativeRowMode,
    };
  } catch {
    return undefined;
  }
}

/**
 * Ordered, compact alternatives for Playwright. Each variant remains a
 * separate candidate so the executor can reject a click whose post-condition
 * did not happen and try the next relation safely.
 */
export function contextualRowActionCandidates(label: string): LocatorCandidate[] {
  const context = parseContextualRowAction(label);
  if (!context) return [];
  const overflow = /^(?:\.{3}|…|more|menu|tuỳ chọn|tùy chọn|thao tác)$/iu.test(context.action);
  const modes: RelativeRowMode[] = overflow
    ? ['metadata', 'accessible', 'actions', 'last']
    : ['accessible', 'metadata', 'actions'];
  return modes.map((mode, index) => ({
    strategy: 'relative',
    value: formatRelativeRowLocator({ ...context, mode }),
    weight: Math.max(0.55, 0.79 - index * 0.06),
    origin: 'healed',
    approved: false,
  }));
}

/** Authored locator templates shared by every data row on one screen. */
export function contextualRowActionTemplateCandidates(action: string): LocatorCandidate[] {
  return contextualRowActionCandidates(`Icon ${action} tại dòng {{rowText}}`).map(
    (candidate, index) => {
      const { approved: _approved, ...template } = candidate;
      return {
        ...template,
        origin: 'authored' as const,
        weight: [0.95, 0.85, 0.75, 0.65][index] ?? 0.6,
      };
    },
  );
}

export function isOverflowRowAction(action: string): boolean {
  return /^(?:\.{3}|…|more|menu|tuỳ chọn|tùy chọn|thao tác)$/iu.test(action.trim());
}

/** Chromedriver-only fallback when direct Playwright relative locators are unavailable. */
export function relativeRowLocatorXPath(value: string): string | undefined {
  const spec = parseRelativeRowLocator(value);
  if (!spec) return undefined;
  const all = contextualRowActionXPaths(`Icon ${spec.action} tại dòng ${spec.rowText}`);
  const index: Record<RelativeRowMode, number> = {
    metadata: 0,
    accessible: 1,
    actions: 2,
    last: 3,
  };
  return all[index[spec.mode]] ?? all[0];
}

/** Parse the canonical label produced by the scenario normalizer. */
export function parseContextualRowAction(label: string): ContextualRowAction | undefined {
  const match = /^Icon\s+(.+?)\s+tại dòng\s+(.+)$/iu.exec(label.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { action: match[1].trim(), rowText: match[2].trim() };
}

/**
 * Build a DOM-relative XPath rather than a positional page-wide selector:
 * exact row text → nearest ancestor containing an action control → requested
 * control. For an ellipsis, the last control is the conventional overflow
 * action. The locator is still verified by the normal resolver before use.
 */
export function contextualRowActionXPath(label: string): string | undefined {
  return contextualRowActionXPaths(label)[0];
}

/**
 * Ordered row-relative candidates for a natural-language action.
 *
 * A single "last icon in the nearest ancestor" XPath is not healing: a stock
 * row can contain a pin icon, chart controls and an overflow icon, and clicking
 * any of them returns successfully from Playwright.  These candidates first
 * establish a semantic row boundary, then rank explicit menu metadata ahead of
 * increasingly generic fallbacks.  The executor validates the resulting UI
 * state before it persists whichever candidate actually worked.
 */
export function contextualRowActionXPaths(label: string): string[] {
  const context = parseContextualRowAction(label);
  if (!context) return [];

  const rowText = xpathLiteral(context.rowText);
  const actionText = xpathLiteral(context.action);
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const control =
    "self::button or @role='button' or self::tcbs-icon or self::mat-icon or @onclick";
  const anchor = `(//*[not(*) and normalize-space(.)=${rowText}])[1]`;
  const classToken = (token: string) =>
    `contains(concat(' ', normalize-space(@class), ' '), ' ${token} ')`;
  const semanticRow =
    `${anchor}/ancestor::*[` +
    `self::tr or @role='row' or ` +
    ROW_CLASS_TOKENS.map(classToken).join(' or ') +
    `][1]`;
  // Last-resort boundary for component libraries that expose no row semantics.
  const genericRow = `${anchor}/ancestor::*[.//*[${control}]][1]`;
  const overflow = /^(?:\.{3}|…|more|menu|tuỳ chọn|tùy chọn|thao tác)$/iu.test(context.action);

  if (overflow) {
    const searchable =
      `translate(concat(@data-walkthrough,' ',@data-testid,' ',@aria-label,' ',@title,' ',@name,' ',@class),` +
      `'${upper}','${lower}')`;
    return [
      // Strongest signal: app-authored instrumentation for an overflow action.
      `((${semanticRow})//*[@data-walkthrough and (` +
        `contains(${searchable},'more') or contains(${searchable},'menu') or ` +
        `contains(${searchable},'overflow') or contains(${searchable},'ellipsis')` +
      `)])[1]`,
      // Accessible/test metadata on the control itself.
      `((${semanticRow})//*[${control} and (` +
        `contains(${searchable},'more') or contains(${searchable},'menu') or ` +
        `contains(${searchable},'overflow') or contains(${searchable},'ellipsis')` +
      `)])[1]`,
      // Conventional row-action container, independent of app-specific names.
      `((${semanticRow})//*[` +
        `${classToken('table-actions')} or ${classToken('row-actions')} or ${classToken('item-actions')}` +
      `]//*[${control}])[last()]`,
      // Structural fallbacks are deliberately last and require outcome proof.
      `((${semanticRow})//*[${control}])[last()]`,
      `((${genericRow})//*[${control}])[last()]`,
    ];
  }

  return [
    `((${semanticRow})//*[${control} and (` +
      `normalize-space(.)=${actionText} or @aria-label=${actionText} or ` +
      `@title=${actionText} or @name=${actionText}` +
    `)])[1]`,
    `((${genericRow})//*[${control} and (` +
      `normalize-space(.)=${actionText} or @aria-label=${actionText} or ` +
      `@title=${actionText} or @name=${actionText}` +
    `)])[1]`,
  ];
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part, i) =>
    `${i ? `,"'",` : ''}'${part}'`).join('')})`;
}
