import type { Locator } from 'playwright';
import type { ControlType } from '../core/types.js';
import type { ControlInspection, UiDriver, UiHandle } from './driver.js';

export interface PlaywrightControlFacts {
  tag: string;
  type: string;
  role: string;
  readOnly: boolean;
  dataMatCalendar: boolean;
  calendarToggle: boolean;
}

/** Pure classification kept separate so every DOM rule has a cheap unit test. */
export function classifyControlFacts(facts: PlaywrightControlFacts): ControlInspection {
  const evidence: string[] = [`playwright-dom: <${facts.tag}>`];
  if (facts.type) evidence.push(`playwright-dom: type=${facts.type}`);
  if (facts.role) evidence.push(`playwright-dom: role=${facts.role}`);
  if (facts.readOnly) evidence.push('playwright-dom: readonly');
  if (facts.dataMatCalendar) evidence.push('playwright-dom: data-mat-calendar');
  if (facts.calendarToggle) evidence.push('playwright-dom: calendar toggle');

  if (facts.type === 'date' || facts.dataMatCalendar || facts.calendarToggle) {
    return { type: 'date', evidence };
  }
  if (facts.tag === 'select' || facts.role === 'combobox' || facts.role === 'listbox') {
    return { type: 'select', evidence };
  }
  if (facts.type === 'checkbox' || facts.role === 'checkbox' || facts.role === 'switch') {
    return { type: 'checkbox', evidence };
  }
  if (facts.type === 'file') return { type: 'file', evidence };
  if (facts.type === 'range' || facts.role === 'slider') return { type: 'slider', evidence };
  if (facts.tag === 'button' || facts.role === 'button') return { type: 'button', evidence };
  if (facts.tag === 'input' || facts.tag === 'textarea' || facts.role === 'textbox') {
    return { type: 'text', evidence };
  }
  return { type: 'unknown', evidence };
}

/** Inspect the exact locator Playwright resolved, not a guessed selector. */
export async function inspectPlaywrightControl(locator: Locator): Promise<ControlInspection> {
  const facts = await locator.evaluate((node): PlaywrightControlFacts => {
    const el = node as HTMLElement;
    const input = el instanceof HTMLInputElement ? el : undefined;
    const field = el.closest('mat-form-field') ?? el.parentElement;
    return {
      tag: el.tagName.toLocaleLowerCase(),
      type: (input?.type ?? el.getAttribute('type') ?? '').toLocaleLowerCase(),
      role: (el.getAttribute('role') ?? '').toLocaleLowerCase(),
      readOnly: Boolean(input?.readOnly || el.hasAttribute('readonly')),
      dataMatCalendar: el.hasAttribute('data-mat-calendar'),
      calendarToggle: Boolean(field?.querySelector(
        'mat-datepicker-toggle, [aria-label*="calendar" i], [aria-haspopup="dialog"]',
      )),
    };
  });
  return classifyControlFacts(facts);
}

export function looksLikeDate(value: string): boolean {
  return /^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2})$/u.test(value.trim());
}

export interface AdaptiveInputResult {
  action: 'input' | 'selectDate';
  inspection?: ControlInspection;
}

/**
 * Route a generic business-level write to the capability the live control
 * actually supports. MCP/DOM inspection is only paid for date-shaped values or
 * controls already learned as dates; ordinary text fields stay on the fast path.
 */
export async function performAdaptiveInput(
  driver: UiDriver,
  handle: UiHandle,
  value: string,
  typeDelay: number | undefined,
  knownType?: ControlType,
): Promise<AdaptiveInputResult> {
  if ((knownType === 'date' || looksLikeDate(value)) && driver.inspectControl) {
    const inspection = await driver.inspectControl(handle);
    if (inspection.type === 'date' && driver.selectDate) {
      await driver.selectDate(handle, value);
      return { action: 'selectDate', inspection };
    }
  }
  await driver.input(handle, value, typeDelay);
  return { action: 'input' };
}
