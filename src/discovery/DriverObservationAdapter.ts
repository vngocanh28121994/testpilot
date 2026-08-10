/**
 * Compatibility bridge between the existing UiDriver.observe() interface
 * and the discovery pipeline's ObservationProvider.
 *
 * The existing observe() returns Observed[] — the flat crawl-era model that
 * lacks bounds, enabled/focused state, and hierarchy.  This adapter converts
 * it to UiObservation so DeterministicMatcher can score candidates.
 *
 * For richer data (bounds, enabled, parent/child): use createNativeObservationProvider
 * from NativeObservationAdapter.ts once NativeUiDriver.getPageSource() is available.
 */

import type { Observed } from '../crawl/observe.js';
import type { UiDriver } from '../drivers/driver.js';
import type { ElementDef } from '../core/types.js';
import type { ObservedElement, UiObservation } from './UiObservation.js';
import type { ObservationProvider } from './ElementDiscovery.js';
import type { ElementIntent } from './ElementIntent.js';
import type { LocatorCandidate } from '../core/types.js';

// ── observation provider factory ──────────────────────────────────────────────

/**
 * Wraps any UiDriver that implements observe() into an ObservationProvider
 * compatible with ElementDiscovery.
 *
 * If the driver has no observe() method (some minimal test drivers), an empty
 * observation is returned — discovery will report no candidates.
 */
export function createDriverObservationProvider(
  driver: UiDriver,
): ObservationProvider {
  return {
    async observe(): Promise<UiObservation> {
      const observed: Observed[] = driver.observe ? await driver.observe() : [];
      return observedToUiObservation(observed, driver.platform as 'android' | 'ios' | 'web');
    },
  };
}

/**
 * Pure conversion: Observed[] → UiObservation.
 * Exported for testing without a live driver.
 */
export function observedToUiObservation(
  observed: Observed[],
  platform: 'android' | 'ios' | 'web',
): UiObservation {
  const elements: ObservedElement[] = observed.map(
    (o, i): ObservedElement => ({
      id: `obs-${i}`,
      role: o.role,
      text: o.text,
      accessibilityLabel: o.name,
      resourceId: o.resourceId,
      testId: o.testId,
      placeholder: o.placeholder,
      css: o.css,
      // observe() only returns elements that exist and are visible.
      // enabled/focused/selected are not tracked in Observed.
      visible: true,
      enabled: true,
      interactive: o.interactive,
      index: o.index,
      childIds: o.container ? [] : undefined,
    }),
  );

  return {
    id: `obs-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    platform,
    source: platform === 'web' ? 'browser' : 'native',
    context: {},
    elements,
  };
}

// ── intent builder ────────────────────────────────────────────────────────────

/**
 * Build a minimal ElementIntent from a Registry element definition.
 *
 * Uses action='assert-visible' because the Resolver's job is to locate
 * the element, not to verify it is interactable — the driver handles that
 * when it actually performs the tap / input.
 */
export function buildElementIntent(
  elementId: string,
  elementDef: ElementDef,
): ElementIntent {
  return {
    id: elementId,
    action: 'assert-visible',
    ...(elementDef.label ? { label: elementDef.label } : {}),
    ...(elementDef.screen ? { screen: elementDef.screen } : {}),
  };
}

// ── strategy mapping ──────────────────────────────────────────────────────────

/**
 * Maps a discovery locator strategy to the LocatorCandidate strategy enum.
 *
 * Discovery uses richer names (resourceId, accessibility); LocatorCandidate
 * uses driver-oriented names (testId, label).  The mapping errs on the side of
 * stability: resourceId is treated as testId because both are developer-written,
 * stable identifiers.
 */
export function mapDiscoveryStrategy(
  strategy: string,
): LocatorCandidate['strategy'] {
  const MAP: Record<string, LocatorCandidate['strategy']> = {
    testId: 'testId',
    resourceId: 'testId',     // stable ID, semantically equivalent to testId
    accessibility: 'label',   // accessibility label → label strategy
    css: 'css',
    xpath: 'xpath',
  };
  return MAP[strategy] ?? 'xpath';
}
