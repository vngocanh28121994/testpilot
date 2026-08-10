import type { LocatorCandidate, Platform } from '../core/types.js';
import type { Registry } from '../core/registry.js';
import type { UiDriver, UiHandle } from '../drivers/driver.js';

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
  constructor(
    private readonly driver: UiDriver,
    private readonly registry: Registry,
    private readonly opts: ResolveOptions = DEFAULT_RESOLVE,
  ) {}

  async resolve(elementId: string, override: Partial<ResolveOptions> = {}): Promise<Resolution> {
    const o = { ...this.opts, ...override };
    const candidates = this.registry.candidates(elementId, this.driver.platform);
    const primary = candidates[0]!;
    const deadline = Date.now() + o.timeoutMs;
    let attempts = 0;

    do {
      for (const candidate of candidates) {
        attempts += 1;
        const handle = await this.tryCandidate(candidate, o);
        if (!handle) continue;

        const isFallback = candidate !== primary;
        if (isFallback && o.verifyHealedMatch && !(await this.plausible(elementId, handle))) {
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
      // Nothing matched this tick. If the UI is still moving, that is a reason to
      // keep waiting rather than to fail.
      await this.driver.isIdle().catch(() => false);
      await sleep(o.pollMs);
    } while (Date.now() < deadline);

    throw new ElementNotFoundError(elementId, this.driver.platform, candidates, attempts);
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
   * Loose sanity check for a healed match. Deliberately permissive — it only has
   * to catch "we found something completely unrelated", not enforce exact copy.
   */
  private async plausible(elementId: string, handle: UiHandle): Promise<boolean> {
    const label = this.registry.element(elementId).label;
    if (!label) return true;
    let text = '';
    try {
      text = await handle.text();
    } catch {
      return true; // No readable text (icon button) — cannot disprove, so allow.
    }
    if (!text) return true;
    return norm(text).includes(norm(label)) || norm(label).includes(norm(text));
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
