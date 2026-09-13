import type { Platform } from './types.js';
import { canonicalTag } from './tagTaxonomy.js';

const ALL_PLATFORMS: Platform[] = ['web', 'android', 'ios'];
const NATIVE_PLATFORMS: Platform[] = ['android', 'ios'];

export function parseTagExpression(expression?: string): string[][] {
  return (expression ?? '')
    .split(',')
    .map((group) => group.split('+').map(canonicalTag).filter(Boolean))
    .filter((group) => group.length > 0);
}

/**
 * Native-system scenarios are deliberately opt-in. A broad run such as an
 * empty filter, @regression or @p0 must not silently pull biometric/camera/OTP
 * fixtures into the established WebView suite. Every OR arm that matches a
 * native scenario therefore has to name @native explicitly.
 */
export function matchesTagExpression(expression: string | undefined, scenarioTags: readonly string[]): boolean {
  const groups = parseTagExpression(expression);
  const isNative = scenarioTags.includes('@native');
  if (groups.length === 0) return !isNative;
  return groups.some((group) =>
    (!isNative || group.includes('@native'))
    && group.every((tag) => scenarioTags.includes(tag)),
  );
}

export function platformsForTags(tags: readonly string[]): Platform[] {
  const explicit = ALL_PLATFORMS.filter((platform) => tags.includes(`@${platform}`));
  if (explicit.length > 0) return explicit;
  return tags.includes('@native') ? [...NATIVE_PLATFORMS] : [...ALL_PLATFORMS];
}

export function scenarioInRunScope(
  expression: string | undefined,
  scenario: { tags: readonly string[]; platforms: readonly string[] },
  platform: Platform,
): boolean {
  return scenario.platforms.includes(platform)
    && matchesTagExpression(expression, scenario.tags);
}
