/**
 * Level 1 of the deterministic discovery pipeline.
 *
 * Checks the RuntimeRegistry for a previously-verified locator that can be
 * reused without triggering a new UI observation.  Only locators with status
 * 'verified' or 'healed' are returned — 'suggested' and 'ai-discovered'
 * entries must go through the full observation path first.
 *
 * If this check succeeds the caller can skip runtime observation entirely
 * and go straight to driver interaction.  If the subsequent driver call
 * fails (element gone / layout changed), the caller should fall through to
 * the observation path and optionally call runtimeRegistry.markExpired().
 */

import type { ElementIntent } from './ElementIntent.js';
import type { RuntimeLocator, RuntimeRegistry } from './RuntimeRegistry.js';

export type KnownLocatorResult =
  | { found: true; locator: RuntimeLocator }
  | { found: false };

/**
 * Returns the best known verified locator for the intent, or { found: false }
 * when none exists or when the best available locator is not yet verified.
 *
 * @param intent        The element to look up.
 * @param registry      RuntimeRegistry holding locator provenance.
 * @param platform      Optional platform filter (android / ios / web).
 */
export function checkKnownLocator(
  intent: ElementIntent,
  registry: RuntimeRegistry,
  platform?: string,
): KnownLocatorResult {
  const best = registry.bestLocator(intent.id, platform);

  if (!best) return { found: false };

  // Only trusted statuses — never allow 'suggested', 'rejected', or 'expired'
  if (best.status !== 'verified' && best.status !== 'healed') {
    return { found: false };
  }

  return { found: true, locator: best };
}
