/**
 * Element identity resolution — G02 (review v6 §4).
 *
 * TestPilot assigns its own observation-scoped IDs (tp-el-N / mcp-el-N).
 * Providers (Appium MCP, Playwright, native driver) have their own runtime IDs.
 * These are DIFFERENT namespaces — never assume they are equal.
 *
 * This interface centralises all namespace translation so no component
 * outside this module ever does raw `elements.find(e => e.id === providerId)`.
 *
 * Supported providers:
 *   appium-mcp  — uses providerElementId stored during inspect()
 *   default     — no provider id (native driver, fallback)
 *
 * Both IDs are ephemeral (observation-scoped). Never persist them as registry
 * locators.
 */

import type { UiObservation } from '../UiObservation.js';

// ── types ─────────────────────────────────────────────────────────────────────

export interface ProviderElementReference {
  /** Provider name — same as ObservedElement.provider. */
  provider: string;
  /** Provider-assigned element id (e.g. the Appium MCP element id). */
  providerElementId: string;
}

export interface ElementIdentityResolver {
  /**
   * Resolve a TestPilot element id → provider element reference.
   * Returns undefined when the element has no provider id (native-only path).
   */
  resolveProviderElement(
    observation: UiObservation,
    testPilotElementId: string,
  ): ProviderElementReference | undefined;

  /**
   * Resolve a provider element id → TestPilot observation id.
   * Used when an MCP findElement() result carries the provider's id,
   * and we need to look it up in the observation element list.
   * Returns undefined when the provider id is not found (stale → re-observe).
   */
  resolveTestPilotId(
    observation: UiObservation,
    providerElementId: string,
  ): string | undefined;
}

// ── Appium MCP implementation ─────────────────────────────────────────────────

export class McpElementIdentityResolver implements ElementIdentityResolver {
  resolveProviderElement(
    observation: UiObservation,
    testPilotElementId: string,
  ): ProviderElementReference | undefined {
    const el = observation.elements.find((e) => e.id === testPilotElementId);
    if (!el?.providerElementId) return undefined;
    return {
      provider: el.provider ?? 'appium-mcp',
      providerElementId: el.providerElementId,
    };
  }

  resolveTestPilotId(
    observation: UiObservation,
    providerElementId: string,
  ): string | undefined {
    const el = observation.elements.find(
      (e) => e.providerElementId === providerElementId,
    );
    return el?.id;
  }
}

// ── no-op implementation for non-MCP drivers ─────────────────────────────────

/** Identity resolver for drivers that don't have a separate provider id namespace. */
export class NativeElementIdentityResolver implements ElementIdentityResolver {
  resolveProviderElement(
    observation: UiObservation,
    testPilotElementId: string,
  ): ProviderElementReference | undefined {
    const el = observation.elements.find((e) => e.id === testPilotElementId);
    if (!el) return undefined;
    return { provider: el.provider ?? 'native', providerElementId: testPilotElementId };
  }

  resolveTestPilotId(
    _observation: UiObservation,
    providerElementId: string,
  ): string | undefined {
    // For native drivers testPilot id === provider id
    return providerElementId;
  }
}
