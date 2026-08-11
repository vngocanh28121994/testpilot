import type { LocatorCandidate, Platform } from '../core/types.js';
import type { Registry } from '../core/registry.js';
import type { UiDriver, UiHandle } from '../drivers/driver.js';
import type { ElementDiscovery } from '../discovery/ElementDiscovery.js';
import type { ObservedElement } from '../discovery/UiObservation.js';
import { buildElementIntent, mapDiscoveryStrategy } from '../discovery/DriverObservationAdapter.js';
import { StandardElementVerifier } from '../discovery/ElementVerifier.js';

export interface ResolveOptions {
  /** Total budget for finding the element. */
  timeoutMs: number;
  pollMs: number;
  /** Require the element to be visible, not merely present in the tree. */
  requireVisible: boolean;
  /**
   * Before accepting a *fallback* candidate, check that its text plausibly
   * matches the element's label. Prevents the classic self-healing failure mode:
   * the framework "recovers" by clicking a completely different button.
   */
  verifyHealedMatch: boolean;
}

export const DEFAULT_RESOLVE: ResolveOptions = {
  timeoutMs: 10_000,
  pollMs: 250,
  requireVisible: true,
  verifyHealedMatch: true,
};

export interface Resolution {
  handle: UiHandle;
  candidate: LocatorCandidate;
  /** True when the winner was not the highest-weighted candidate. */
  healed: boolean;
  previous?: LocatorCandidate;
  attempts: number;
}

export class ElementNotFoundError extends Error {
  constructor(
    readonly elementId: string,
    readonly platform: Platform,
    readonly tried: LocatorCandidate[],
    readonly attempts: number,
  ) {
    super(
      `Could not resolve "${elementId}" on ${platform} after ${attempts} attempts. ` +
        `Tried: ${tried.map((c) => `${c.strategy}=${c.value}`).join(', ')}`,
    );
    this.name = 'ElementNotFoundError';
  }
}

/**
 * All waiting in TestPilot happens here, and nowhere else.
 *
 * The loop re-queries the whole candidate list on every tick instead of locking
 * onto one selector and waiting on it. That is what makes a step survive a
 * re-render, a late hydration, or a renamed testId: the *element* is the unit of
 * waiting, not the selector.
 */
export class Resolver {
  // G04: single authoritative verification engine — shared with ElementDiscovery
  private readonly verifier = new StandardElementVerifier();

  constructor(
    private readonly driver: UiDriver,
    private readonly registry: Registry,
    private readonly opts: ResolveOptions = DEFAULT_RESOLVE,
    /**
     * Optional discovery engine.  When present, the resolver tries it once
     * after all known candidates fail on the first tick — effectively adding a
     * self-healing observation pass before giving up.
     *
     * Kept optional so callers that haven't wired a RuntimeRegistry yet
     * (scripts, CLI commands) continue to work without changes.
     */
    private readonly elementDiscovery?: ElementDiscovery,
  ) {}

  async resolve(elementId: string, override: Partial<ResolveOptions> = {}): Promise<Resolution> {
    const o = { ...this.opts, ...override };
    // Copy so unshift() below doesn't mutate the registry's internal array.
    const candidates = [...this.registry.candidates(elementId, this.driver.platform)];
    const primary = candidates[0]!;
    const deadline = Date.now() + o.timeoutMs;
    let attempts = 0;
    let discoveryAttempted = false;

    do {
      for (const candidate of candidates) {
        attempts += 1;
        const handle = await this.tryCandidate(candidate, o);
        if (!handle) continue;

        const isFallback = candidate !== primary;
        if (isFallback && o.verifyHealedMatch && !(await this.verifySemantically(elementId, handle))) {
          continue;
        }

        this.registry.recordResolution(elementId, this.driver.platform, candidate);
        return {
          handle,
          candidate,
          healed: isFallback,
          ...(isFallback ? { previous: primary } : {}),
          attempts,
        };
      }

      // After the first tick where all known candidates fail, try the discovery
      // pipeline once.  It observes the live UI, runs DeterministicMatcher, and
      // — when confident enough — returns a freshly observed locator.  That
      // locator is prepended so the next tick tries it before the stale ones.
      if (this.elementDiscovery && !discoveryAttempted) {
        discoveryAttempted = true;
        const discovered = await this.tryDiscovery(elementId);
        if (discovered) candidates.unshift(discovered);
      }

      // Nothing matched this tick. If the UI is still moving, that is a reason to
      // keep waiting rather than to fail.
      await this.driver.isIdle().catch(() => false);
      await sleep(o.pollMs);
    } while (Date.now() < deadline);

    throw new ElementNotFoundError(elementId, this.driver.platform, candidates, attempts);
  }

  /**
   * Runs the discovery pipeline for one element.  Returns a LocatorCandidate
   * suitable for prepending to the active candidate list, or null on any failure.
   *
   * Errors from discovery (observation timeout, driver offline, etc.) are
   * swallowed: discovery is a best-effort enhancement, not a hard dependency.
   */
  private async tryDiscovery(elementId: string): Promise<LocatorCandidate | null> {
    try {
      const elementDef = this.registry.element(elementId);
      const intent = buildElementIntent(elementId, elementDef);
      // Lower threshold than the standard 60: this is a fallback after all known
      // locators have already failed.  The resolver's own plausible() guard still
      // catches completely unrelated matches when verifyHealedMatch is on.
      // context:'healing' bypasses G01 so the fallback never re-uses a stale
      // registry locator — it must observe the live UI fresh.
      const result = await this.elementDiscovery!.discover(intent, {
        minConfidence: 40,
        context: 'healing',
      });
      if (result.method === 'failed' || !result.locator) return null;
      return {
        strategy: mapDiscoveryStrategy(result.locator.strategy),
        value: result.locator.value,
        // Clamp weight at 0.95 — a runtime-observed locator is never as certain
        // as one explicitly authored, but ranks above unverified fallbacks.
        weight: Math.min(0.95, (result.match?.confidence ?? 80) / 100),
        origin: 'healed',
      };
    } catch (err) {
      // Discovery is non-critical; warn but do not propagate.
      console.warn(`[discovery] "${elementId}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Waits until the element is gone. Used by assertNotVisible. */
  async resolveAbsent(elementId: string, override: Partial<ResolveOptions> = {}): Promise<void> {
    const o = { ...this.opts, ...override };
    const candidates = this.registry.candidates(elementId, this.driver.platform);
    const deadline = Date.now() + o.timeoutMs;

    do {
      let anyVisible = false;
      for (const candidate of candidates) {
        if (await this.tryCandidate(candidate, o)) {
          anyVisible = true;
          break;
        }
      }
      if (!anyVisible) return;
      await sleep(o.pollMs);
    } while (Date.now() < deadline);

    throw new Error(`Element "${elementId}" was still visible after ${o.timeoutMs}ms.`);
  }

  private async tryCandidate(
    candidate: LocatorCandidate,
    o: ResolveOptions,
  ): Promise<UiHandle | null> {
    try {
      const handle = await this.driver.find(candidate);
      if (!handle) return null;
      if (o.requireVisible && !(await handle.isVisible())) return null;
      return handle;
    } catch {
      // A driver-level error (stale node, strategy unsupported on this platform)
      // is treated as "this candidate did not match", not as a test failure.
      return null;
    }
  }

  /**
   * Semantic verification for healed matches — G04.
   *
   * Replaces the old `plausible()` text-only heuristic with a call to the
   * authoritative StandardElementVerifier so there is ONE verification engine
   * across the entire discovery + resolver stack.
   *
   * Builds a minimal ObservedElement from the live UiHandle properties and
   * delegates to StandardElementVerifier.verify(). Permissive on unreadable
   * text (icon buttons) — if text() throws, we cannot disprove the match, so
   * we allow it (same as before, but now explicit and documented).
   */
  private async verifySemantically(elementId: string, handle: UiHandle): Promise<boolean> {
    const elementDef = this.registry.element(elementId);
    const intent = buildElementIntent(elementId, elementDef);

    // Build a minimal ObservedElement from the runtime handle (G04)
    const el: ObservedElement = {
      id: handle.candidate.value,
      visible: true, // already verified by tryCandidate via requireVisible
      enabled: undefined,
      interactive: undefined,
    };

    try {
      el.text = await handle.text();
    } catch {
      // Cannot read text (icon button, SVG, etc.) — cannot disprove match, allow
      return true;
    }

    if (!el.text) {
      // Empty text — cannot verify label, allow (same historical behaviour)
      return true;
    }

    // G04: delegate to StandardElementVerifier — single authoritative engine
    const result = this.verifier.verify(intent, el, []);
    // labelMatch=undefined means intent has no label → allow
    // labelMatch=true → element text matches → allow
    // labelMatch=false → wrong element — reject
    return result.checks.labelMatch !== false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
