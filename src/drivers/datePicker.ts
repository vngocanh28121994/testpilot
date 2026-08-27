import type { Locator } from 'playwright';

export interface ParsedDate {
  day: number;
  month: number;
  year: number;
}

/** Accepts the two formats business users commonly write in scenarios. */
export function parseDate(value: string): ParsedDate {
  const trimmed = value.trim();
  let match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  let day: number;
  let month: number;
  let year: number;
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
    if (!match) throw new Error(`Ngày "${value}" không đúng định dạng DD/MM/YYYY hoặc YYYY-MM-DD.`);
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Ngày "${value}" không tồn tại.`);
  }
  return { day, month, year };
}

export function sameDate(actual: string, expected: string): boolean {
  try {
    const left = parseDate(actual);
    const right = parseDate(expected);
    return left.day === right.day && left.month === right.month && left.year === right.year;
  } catch {
    return false;
  }
}

/**
 * Set a web date control and fire the events Angular/React forms consume.
 * Works for editable HTML date inputs and readonly Angular Material inputs.
 */
export async function selectDateWithPlaywright(locator: Locator, requested: string): Promise<void> {
  const date = parseDate(requested);
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const result = await locator.evaluate(
    (node, payload: { requested: string; iso: string }) => {
      if (!(node instanceof HTMLInputElement)) {
        return { status: 'not-input' as const, value: '' };
      }
      const value = node.type === 'date' ? payload.iso : payload.requested;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      node.focus();
      if (setter) setter.call(node, value);
      else node.value = value;
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new Event('blur', { bubbles: true }));
      node.blur();
      return { status: 'ok' as const, value: node.value };
    },
    {
      requested,
      iso: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
    },
  );
  if (result.status === 'not-input') {
    throw new Error('Date locator không trỏ vào input.');
  }
  // Give Angular's form-control listener one turn to commit the value. Locator
  // intentionally does not expose its Page in every supported Playwright
  // version, so keep this helper independent from that API detail.
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  const actual = await locator.inputValue();
  if (!sameDate(actual, requested)) {
    throw new Error(`Date field không nhận giá trị "${requested}"; giá trị hiện tại là "${actual}".`);
  }
}
