import { ROW_SELECTOR } from '../core/rows.js';
import type { Locator, Page } from 'playwright';
import { parseRelativeRowLocator } from '../core/contextual.js';
import type { LocatorCandidate } from '../core/types.js';

type LocatorRoot = Page | Locator;

/** Build a compact row → control relation with Playwright locators, not XPath. */
export function toRelativePlaywrightLocator(
  root: LocatorRoot,
  candidate: LocatorCandidate,
): Locator {
  const spec = parseRelativeRowLocator(candidate.value);
  if (!spec) throw new Error(`Invalid relative locator: ${candidate.value}`);

  const rows = root.locator(ROW_SELECTOR);
  const row = rows.filter({ has: root.getByText(spec.rowText, { exact: true }) });
  const overflow = /^(?:\.{3}|…|more|menu|tuỳ chọn|tùy chọn|thao tác)$/iu.test(spec.action);

  switch (spec.mode) {
    case 'metadata':
      if (!overflow) {
        const value = cssString(spec.action);
        return row.locator(
          `[data-testid=${value}], [data-test=${value}], [data-cy=${value}], ` +
          `[data-walkthrough=${value}], [aria-label=${value}], [title=${value}]`,
        );
      }
      return row.locator([
        '[data-testid*="more" i]', '[data-testid*="menu" i]', '[data-testid*="overflow" i]', '[data-testid*="ellipsis" i]',
        '[data-walkthrough*="more" i]', '[data-walkthrough*="menu" i]', '[data-walkthrough*="overflow" i]', '[data-walkthrough*="ellipsis" i]',
        '[aria-label*="more" i]', '[aria-label*="menu" i]', '[aria-label*="overflow" i]',
        '[title*="more" i]', '[title*="menu" i]', '[title*="overflow" i]',
      ].join(', '));

    case 'accessible': {
      const name = overflow
        ? /more|menu|overflow|ellipsis|tuỳ chọn|tùy chọn|thao tác/i
        : exactRegex(spec.action);
      return row.getByRole('button', { name }).or(
        row.locator('tcbs-icon, mat-icon, [role="button"]').filter({ hasText: name }),
      );
    }

    case 'actions':
      return row.locator(
        '.table-actions button, .row-actions button, .item-actions button, ' +
        '.table-actions [role="button"], .row-actions [role="button"], .item-actions [role="button"], ' +
        '.table-actions tcbs-icon, .row-actions tcbs-icon, .item-actions tcbs-icon',
      ).last();

    case 'last':
      return row.locator(
        'button, [role="button"], tcbs-icon, mat-icon, [onclick]',
      ).last();
  }
}

function exactRegex(value: string): RegExp {
  return new RegExp(`^\\s*${escapeRegex(value)}\\s*$`, 'iu');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssString(value: string): string {
  return JSON.stringify(value);
}
