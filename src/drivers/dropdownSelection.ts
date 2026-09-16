import { normalizeHumanText } from '../core/text.js';
import type { UiDriver, UiHandle } from './driver.js';

export const ANY_DROPDOWN_OPTION = '__testpilot:any-option__';
export const DEFAULT_DROPDOWN_OPTION = '__testpilot:default-option__';

/** Turn a business choice policy into the exact option label visible now. */
export async function resolveDropdownOption(
  driver: UiDriver,
  handle: UiHandle,
  requested: string,
): Promise<string> {
  const policy = requested === ANY_DROPDOWN_OPTION
    ? 'any'
    : requested === DEFAULT_DROPDOWN_OPTION
      ? 'default'
      : undefined;
  if (!policy) return requested;
  if (!driver.listOptions) {
    throw new Error('Driver hiện tại không đọc được các lựa chọn trong dropdown.');
  }

  const options = await driver.listOptions(handle);
  if (!options) throw new Error('Không đọc được các lựa chọn trong dropdown.');
  const labels = [...new Set(options.map((option) => option.trim()).filter(Boolean))];
  if (labels.length === 0) throw new Error('Dropdown không có lựa chọn nào để chọn.');

  const current = normalizeHumanText(
    (await handle.value?.().catch(() => null))
      ?? (await handle.text().catch(() => '')),
  );
  const isCurrent = (label: string): boolean => {
    const normalized = normalizeHumanText(label);
    return Boolean(current) && (current === normalized || current.includes(normalized));
  };
  const isNamedDefault = (label: string): boolean => /(?:^|\s)(?:default|mac dinh)(?:\s|$)/iu
    .test(normalizeHumanText(label));

  if (policy === 'default') {
    // Some products do not print "mặc định"; their first entry is the
    // configured default, so UI order is the deterministic fallback.
    return labels.find(isNamedDefault) ?? labels[0]!;
  }

  const alternatives = labels.filter((label) => !isCurrent(label));
  const nonDefault = alternatives.filter((label) => !isNamedDefault(label));
  if (nonDefault.length > 0) {
    // Without a readable current value, avoid the conventional first/default
    // entry so "bất kỳ" cannot silently become a no-op.
    if (!current && nonDefault.length === labels.length && nonDefault.length > 1) return nonDefault[1]!;
    return nonDefault[0]!;
  }
  if (alternatives.length > 0) return alternatives[0]!;
  throw new Error('Dropdown không có lựa chọn nào khác giá trị hiện tại.');
}
