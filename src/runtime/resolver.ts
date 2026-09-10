import type { LocatorCandidate, Platform } from '../core/types.js';
import type { Registry } from '../core/registry.js';
import { protectedSelectors, type UiDriver, type UiHandle } from '../drivers/driver.js';
import type { ElementDiscovery } from '../discovery/ElementDiscovery.js';
import type { SemanticElementDiscovery } from '../discovery/ai/SemanticElementDiscovery.js';
import type { ObservedElement, UiObservation } from '../discovery/UiObservation.js';
import type { ActionKind, ElementIntent } from '../discovery/ElementIntent.js';
import { buildElementIntent, mapDiscoveryStrategy } from '../discovery/DriverObservationAdapter.js';
import { StandardElementVerifier } from '../discovery/ElementVerifier.js';
import {
  contextualRowActionCandidates,
  formatRelativeRowLocator,
  parseRelativeRowLocator,
} from '../core/contextual.js';
import { assessLocatorQuality, asUnapprovedFallback } from '../core/locatorQuality.js';
import { xpathLiteral } from '../core/labelXPath.js';

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
  /** Runtime action that the discovered element must safely support. */
  discoveryAction?: ActionKind;
  /** Candidate keys rejected by an action postcondition during this step. */
  excludeCandidateKeys?: string[];
  /** Values used to instantiate authored locator templates for this step. */
  locatorParams?: Record<string, string>;
  /** Previous/next business assertions that narrow runtime discovery. */
  semanticContext?: string[];
  /** The last successfully asserted business region, when one exists. */
  contextAnchor?: string;
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
    readonly urlMismatch?: { expected: string; actual: string },
  ) {
    const base =
      `Could not resolve "${elementId}" on ${platform} after ${attempts} attempts. ` +
      `Tried: ${tried.map((c) => `${c.strategy}=${c.value}`).join(', ')}`;
    const hint = urlMismatch
      ? ` | URL mismatch: expected "${urlMismatch.expected}" but got "${urlMismatch.actual}" — app may have navigated to the wrong screen.`
      : '';
    super(base + hint);
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
    readonly registry: Registry,
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
    /**
     * The AI fallback, when the config turns it on. Absent means the resolver
     * behaves exactly as it did before this tier existed.
     */
    private readonly semanticDiscovery?: SemanticElementDiscovery,
    private readonly aiMinConfidence = 60,
  ) {}

  async resolve(elementId: string, override: Partial<ResolveOptions> = {}): Promise<Resolution> {
    const o = { ...this.opts, ...override };

    // Load screen definition for this element — used for cssScope + urlPattern.
    const elementDef = this.registry.element(elementId);
    const screenDef = elementDef.screen ? this.registry.screen(elementDef.screen) : undefined;
    const cssScope = screenDef?.cssScope;

    // Copy so unshift() below doesn't mutate the registry's internal array,
    // then apply cssScope: prefix every css candidate with the screen scope so
    // selectors stay short in the registry but are safely narrowed at runtime.
    const rawCandidates = this.registry.candidates(elementId, this.driver.platform)
      .map((candidate) => instantiateCandidate(candidate, o.locatorParams));
    const authoredPrimary = rawCandidates[0];
    const excluded = new Set(o.excludeCandidateKeys ?? []);
    const candidates = this.prepareCandidates(
      this.withSemanticLabelFallback(
        rawCandidates,
        interpolateTemplate(elementDef.label, o.locatorParams),
        o.contextAnchor,
      ),
      cssScope,
    )
      .filter((candidate) => !excluded.has(candidateKey(candidate)));

    // Every locator the registry itself declares for this element, prepared the
    // same way so the keys line up with `candidates` above.
    //
    // The registry lists candidates in priority order on purpose: that ordering
    // *is* the fallback plan, written by whoever authored the element. Semantic
    // verification exists for locators nobody authored — ones discovery invents
    // mid-run — and applying it to the element's own second choice quietly
    // cancels the plan. It did: `role=combobox` is ambiguous on the mobile web
    // build (three of them on one screen), `label=Chuyển từ` found the right
    // control every time, and every time it was thrown away unverified-looking.
    const authoredKeys = new Set(
      this.prepareCandidates(rawCandidates, cssScope).map(candidateKey),
    );
    const deadline = Date.now() + o.timeoutMs;
    let attempts = 0;
    let ticks = 0;
    /** Ứng viên do discovery tìm ra, có thể về sau vài tick. */
    let discovered: LocatorCandidate | null = null;
    let discoverySettled = false;
    let discoveryStartedAt = 0;
    let discoveryAttempted = false;
    let lastUrl: string | undefined;

    // Deliberately no popup sweep before the first look.
    //
    // Clearing first means the answer to "did the application respond?" is
    // asked of a page this code has already tidied. A validation dialog was
    // dismissed here — by clicking its own ĐÓNG button — and the assertion that
    // followed reported the message had never appeared. Three diagnoses were
    // drawn from the resulting blank screen and all three were wrong.
    //
    // The order is the whole fix: look, and only if nothing matched, clear and
    // look again (the miss path below). A nuisance overlay still costs one
    // candidate sweep before it is removed, which is the price of not
    // destroying the evidence in the common case. Protecting the overlay
    // instead was considered and rejected — it cannot tell the app's own answer
    // from a coach mark that happened to appear at the same moment.
    do {
      // Capture URL each tick — used for error diagnostics and urlPattern matching.
      if (this.driver.currentUrl) {
        lastUrl = await this.driver.currentUrl().catch(() => undefined);
        if (lastUrl && !discoveryAttempted && attempts === 0) {
          // Log the URL on the first tick so we can discover real route patterns.
          console.log(`[resolver] "${elementId}" screen="${elementDef.screen}" url="${lastUrl}"`);
        }
      }

      for (const candidate of candidates) {
        attempts += 1;
        const handle = await this.tryCandidate(candidate, o);
        if (!handle) continue;

        // `origin: healed` describes how a locator first entered the registry,
        // not whether it is still a fallback today. Once an operation has
        // verified and persisted that locator it may become the highest-ranked
        // candidate. Treating it as a fallback forever re-runs label matching
        // on every use and rejects valid structural locators whose live text is
        // dynamic (for example the generic "first search result" element whose
        // current text is a stock code such as "ADS-HOSE").
        //
        // A candidate is a fallback only when it is not the registry's current
        // primary candidate. A locator discovered during this resolve is not in
        // `rawCandidates`, so it remains a fallback and still receives semantic
        // verification before an action can use it.
        // Two different questions, previously answered by one flag.
        //
        // `isFallback` is for the record: anything other than the primary won,
        // which is worth reporting whether or not it was authored.
        //
        // `unauthored` is the gate: only a locator the registry never declared
        // has to prove itself. Conflating them meant an authored fallback was
        // treated as if discovery had invented it.
        const isFallback =
          !authoredPrimary || candidateKey(candidate) !== candidateKey(authoredPrimary);
        const unauthored = !authoredKeys.has(candidateKey(candidate));
        if (
          unauthored &&
          o.verifyHealedMatch &&
          !(await this.verifySemantically(elementId, handle, o.locatorParams))
        ) {
          continue;
        }

        return {
          handle,
          candidate,
          healed: isFallback,
          ...(isFallback && authoredPrimary ? { previous: authoredPrimary } : {}),
          attempts,
        };
      }

      ticks += 1;

      // Give authored/previously verified locators several cheap polling ticks
      // before invoking discovery. A normal route transition can take a few
      // seconds; starting a full DOM observation after the very first miss used
      // to consume almost the entire post-click budget and leave a known-good
      // locator with only one attempt.
      if (this.elementDiscovery && !discoveryAttempted && ticks >= 3) {
        discoveryAttempted = true;
        discoveryStartedAt = Date.now();
        // Chạy nền, KHÔNG đua với đồng hồ rồi vứt kết quả.
        //
        // Bản cũ đặt discovery vào Promise.race với sleep(2s). Trên iOS, một lần
        // lấy cây giao diện đã mất ~900ms (đo thật, có lần 11–12 giây), cộng
        // parse, chấm điểm và có thể một lượt gọi model — nên nó gần như luôn
        // thua cuộc đua. Thua thì kết quả bị bỏ, và tệ hơn: câu giải thích "vì
        // sao không tìm được" nằm bên trong chính lời hứa bị bỏ đó, nên một
        // discovery thất bại trông y hệt một discovery chưa từng chạy.
        //
        // Chạy nền thì mỗi vòng lặp sau chỉ việc hỏi "có kết quả chưa" — không
        // tick nào bị chặn, và kết quả về muộn vẫn kịp dùng trong cùng lần
        // resolve này.
        void this.tryDiscovery(
          elementId,
          o.discoveryAction,
          o.locatorParams,
          o.semanticContext,
        )
          .then((c) => { discovered = c; })
          .catch(() => { discovered = null; })
          .finally(() => { discoverySettled = true; });
      }
      if (discovered && !excluded.has(candidateKey(discovered))) {
        candidates.unshift(discovered);
        discovered = null;
      }

      // A native overlay (permission dialog, system popup) sits above the WebView
      // and blocks every locator. Dismiss it and retry immediately — but never
      // the layer holding what this very loop is waiting for, which is what an
      // app that reports errors in a dialog produces on every failed login.
      if (this.driver.dismissOverlay) {
        const dismissed = await this.driver
          .dismissOverlay(protectedSelectors(candidates))
          .catch(() => false);
        if (dismissed) continue;
      }

      // Nothing matched this tick. If the UI is still moving, that is a reason to
      // keep waiting rather than to fail.
      await this.driver.isIdle().catch(() => false);
      await sleep(o.pollMs);
    } while (Date.now() < deadline);

    // Discovery vẫn đang chạy khi hết giờ là một câu trả lời, không phải im
    // lặng. Trước đây trường hợp này không để lại dấu vết nào, nên "discovery
    // không tìm ra" và "discovery chưa kịp chạy xong" trông giống hệt nhau —
    // và người đi truy phải đoán. Trên iOS nó là trường hợp thường gặp: riêng
    // một lần lấy cây giao diện đã tốn khoảng 900ms.
    if (discoveryAttempted && !discoverySettled) {
      console.warn(
        `[discovery] "${elementId}": chưa trả lời xong sau ${Date.now() - discoveryStartedAt}ms `
        + '— hết hạn resolve trước. Tăng resolve.timeoutMs nếu màn hình này vốn chậm.',
      );
    }

    // Build URL mismatch hint when the app ended up on a different screen.
    const urlMismatch =
      lastUrl !== undefined && screenDef?.urlPattern && !lastUrl.includes(screenDef.urlPattern)
        ? { expected: screenDef.urlPattern, actual: lastUrl }
        : undefined;

    throw new ElementNotFoundError(elementId, this.driver.platform, candidates, attempts, urlMismatch);
  }

  /**
   * Runs the discovery pipeline for one element.  Returns a LocatorCandidate
   * suitable for prepending to the active candidate list, or null on any failure.
   *
   * Errors from discovery (observation timeout, driver offline, etc.) are
   * swallowed: discovery is a best-effort enhancement, not a hard dependency.
   */
  /** Element ids whose discovery failure has already been explained this run. */
  private readonly discoveryReported = new Set<string>();
  /** Element ids already proposed by the AI tier — one call each per run. */
  private readonly aiProposed = new Set<string>();

  /**
   * Asks the AI tier what the deterministic pipeline could not find.
   *
   * The result may participate in this run, but it is still only a candidate:
   * driver.find() must resolve it against the live DOM, semantic verification
   * must accept the element, and a tap is persisted only after its observable
   * postcondition succeeds. This gives new natural-language steps a useful
   * first run without treating model output as execution proof.
   */
  private async proposeViaAi(
    intent: ElementIntent,
    observation: UiObservation,
    elementId: string,
  ): Promise<LocatorCandidate | null> {
    if (!this.semanticDiscovery || this.aiProposed.has(elementId)) return null;
    this.aiProposed.add(elementId);

    const result = await this.semanticDiscovery
      .discover(intent, observation, { minConfidence: this.aiMinConfidence })
      .catch((err: Error) => ({ method: 'failed' as const, evidence: [err.message] }));
    if (!result || result.method === 'failed' || !('locator' in result) || !result.locator) {
      // Say why. A tier that declines in silence is indistinguishable from one
      // that never ran, and that ambiguity cost an afternoon of guessing once
      // today already.
      const why = (result?.evidence ?? []).slice(-2).join(' | ');
      console.warn(`[discovery:ai] "${elementId}" không đề xuất được: ${why.slice(0, 200)}`);
      return null;
    }

    const proposed: LocatorCandidate = {
      strategy: mapDiscoveryStrategy(result.locator.strategy),
      value: result.locator.value,
      weight: Math.min(0.9, (result.match?.confidence ?? 60) / 100),
      // Treat it as a runtime healing candidate only after AI has selected it
      // from the live observation. confirmResolution() remains the sole place
      // that can persist it after action/outcome verification.
      origin: 'healed',
    };
    const quality = assessLocatorQuality(proposed);
    if (!quality.persistable) return null;

    console.warn(
      `[discovery:ai] "${elementId}" → ${proposed.strategy}="${proposed.value}" ` +
        `(tin cậy ${result.match?.confidence ?? '?'}) — thử trên UI thật trong lần chạy này; ` +
        'chỉ lưu sau khi action tạo đúng trạng thái.',
    );
    return proposed;
  }

  private async tryDiscovery(
    elementId: string,
    action: ActionKind = 'assert-visible',
    locatorParams?: Record<string, string>,
    semanticContext?: string[],
  ): Promise<LocatorCandidate | null> {
    try {
      const elementDef = this.registry.element(elementId);
      const intent = buildElementIntent(elementId, {
        ...elementDef,
        label: interpolateTemplate(elementDef.label, locatorParams),
      }, action, semanticContext);
      // Lower threshold than the standard 60: this is a fallback after all known
      // locators have already failed.  The resolver's own plausible() guard still
      // catches completely unrelated matches when verifyHealedMatch is on.
      // context:'healing' bypasses G01 so the fallback never re-uses a stale
      // registry locator — it must observe the live UI fresh.
      const result = await this.elementDiscovery!.discover(intent, {
        minConfidence: 40,
        context: 'healing',
        platform: this.driver.platform,
        screen: elementDef.screen,
        // Identity verification makes this candidate safe to try, but only the
        // executor can prove that the requested action had the intended effect.
        persistVerifiedLocator: false,
      });
      if (result.method === 'failed' || !result.locator) {
        // Say why, once per element. discover() collects an evidence trail and
        // this threw it away, so a failed discovery looked identical to one
        // that never ran — and diagnosing an unfindable element meant guessing
        // from the outside for an afternoon.
        // Re-uses the observation discover() already took — the AI tier must not
        // cost a second trip to the device.
        if (result.observation) {
          const proposed = await this
            .proposeViaAi(intent, result.observation, elementId)
            .catch(() => null);
          if (proposed) return proposed;
        }
        if (!this.discoveryReported.has(elementId)) {
          this.discoveryReported.add(elementId);
          console.warn(
            `[discovery] "${elementId}" không tìm được: ${result.evidence.slice(-3).join(' | ')}`,
          );
        }
        return null;
      }
      const candidate: LocatorCandidate = {
        strategy: mapDiscoveryStrategy(result.locator.strategy),
        value: result.locator.value,
        // Clamp weight at 0.95 — a runtime-observed locator is never as certain
        // as one explicitly authored, but ranks above unverified fallbacks.
        weight: Math.min(0.95, (result.match?.confidence ?? 80) / 100),
        origin: 'healed',
      };
      return candidate;
    } catch (err) {
      // Discovery is non-critical; warn but do not propagate.
      console.warn(`[discovery] "${elementId}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Waits until the element is gone. Used by assertNotVisible. */
  async resolveAbsent(elementId: string, override: Partial<ResolveOptions> = {}): Promise<void> {
    const o = { ...this.opts, ...override };
    const elementDef = this.registry.element(elementId);
    const screenDef = elementDef.screen ? this.registry.screen(elementDef.screen) : undefined;
    const candidates = this.prepareCandidates(
      this.withSemanticLabelFallback(
        this.registry.candidates(elementId, this.driver.platform)
          .map((candidate) => instantiateCandidate(candidate, o.locatorParams)),
        interpolateTemplate(elementDef.label, o.locatorParams),
      ),
      screenDef?.cssScope,
    );
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

  /** One-shot visibility probe. It never discovers, waits, records, or persists. */
  async isVisibleNow(
    elementId: string,
    override: Partial<ResolveOptions> = {},
  ): Promise<boolean> {
    return Boolean(await this.visibleResolutionNow(elementId, override));
  }

  /**
   * `isVisibleNow` with the winning handle kept instead of thrown away.
   *
   * Callers that need to compare an element's contents before and after an
   * action would otherwise have to resolve it twice — once to learn it is on
   * screen and once to read it. The probe already has the handle in hand.
   */
  async visibleResolutionNow(
    elementId: string,
    override: Partial<ResolveOptions> = {},
  ): Promise<{ candidate: LocatorCandidate; handle: UiHandle } | undefined> {
    const o = { ...this.opts, ...override };
    const elementDef = this.registry.element(elementId);
    const screenDef = elementDef.screen ? this.registry.screen(elementDef.screen) : undefined;
    const candidates = this.prepareCandidates(
      this.withSemanticLabelFallback(
        this.registry.candidates(elementId, this.driver.platform)
          .map((candidate) => instantiateCandidate(candidate, o.locatorParams)),
        interpolateTemplate(elementDef.label, o.locatorParams),
      ),
      screenDef?.cssScope,
    );
    for (const candidate of candidates) {
      const handle = await this.tryCandidate(candidate, { ...o, requireVisible: true });
      if (handle) return { candidate, handle };
    }
    return undefined;
  }

  /**
   * Commit health and healed locator data after the operation (and, for taps,
   * its postcondition) has succeeded. Resolve alone is intentionally read-only.
   */
  confirmResolution(elementId: string, resolution: Resolution): void {
    const candidate = resolution.candidate;
    this.registry.recordResolution(elementId, this.driver.platform, candidate);
    if (candidate.origin !== 'healed') return;

    const {
      runtimeScope: _runtimeScope,
      runtimeTemplateValue: _runtimeTemplateValue,
      ...persisted
    } = candidate;
    const quality = assessLocatorQuality(persisted);
    if (!quality.persistable) return;

    const elementDef = this.registry.element(elementId);
    this.registry.upsertElement({
      ...elementDef,
      candidates: {
        [this.driver.platform]: [asUnapprovedFallback(persisted)],
      },
    });
    this.elementDiscovery?.confirmLocator(
      elementId,
      { strategy: candidate.strategy, value: candidate.value },
      this.driver.platform,
      candidate.weight,
    );
  }

  /** Mark an outcome-invalid runtime candidate so it cannot silently win later. */
  rejectResolution(elementId: string, resolution: Resolution): void {
    if (resolution.candidate.origin !== 'healed') return;
    this.elementDiscovery?.rejectLocator(elementId, resolution.candidate);
  }

  private prepareCandidates(
    raw: LocatorCandidate[],
    cssScope?: string,
  ): LocatorCandidate[] {
    const expanded: LocatorCandidate[] = [];
    for (const candidate of raw) {
      if (this.driver.platform === 'web' && candidate.strategy === 'label') {
        contextualRowActionCandidates(candidate.value).forEach((contextual) => {
          expanded.push({
            ...contextual,
            ...(candidate.noScope ? { noScope: true } : {}),
          });
        });
      }
      expanded.push(candidate);
    }

    // Apply cssScope to every locator strategy by chaining in the driver.
    return expanded.map((candidate) =>
      cssScope && !candidate.noScope
        ? { ...candidate, runtimeScope: cssScope }
        : candidate,
    ).sort((a, b) => b.weight - a.weight);
  }

  /**
   * Natural-language scenarios may intentionally enter the registry without a
   * selector. On web, Playwright's semantic text engine is the cheapest and
   * most reliable first discovery step; a full observation crawl remains the
   * fallback when this candidate does not exist or is ambiguous.
   */
  private withSemanticLabelFallback(
    candidates: LocatorCandidate[],
    label?: string,
    contextAnchor?: string,
  ): LocatorCandidate[] {
    if (candidates.length > 0 || this.driver.platform !== 'web' || !label?.trim()) {
      return candidates;
    }
    const full = label.trim();
    const compact = compactOptionFromLabel(full);
    const contextual = compact && contextAnchor
      ? contextualCompactXPath(contextAnchor, compact)
      : undefined;
    return [
      ...(contextual
        ? [{
            strategy: 'xpath' as const,
            value: contextual,
            weight: 0.86,
            origin: 'healed' as const,
          }]
        : []),
      ...(compact
        && !contextual
        ? [{
            strategy: 'xpath' as const,
            value: `//*[not(*) and normalize-space(.)=${xpathLiteral(compact)}]`,
            weight: 0.74,
            origin: 'healed' as const,
          }]
        : []),
      { strategy: 'label', value: full, weight: 0.7, origin: 'healed' },
    ];
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
  private async verifySemantically(
    elementId: string,
    handle: UiHandle,
    locatorParams?: Record<string, string>,
  ): Promise<boolean> {
    const elementDef = this.registry.element(elementId);
    const intent = buildElementIntent(elementId, {
      ...elementDef,
      label: interpolateTemplate(elementDef.label, locatorParams),
    });

    // Build a minimal ObservedElement from the runtime handle (G04)
    const el: ObservedElement = {
      id: handle.candidate.value,
      visible: true, // already verified by tryCandidate via requireVisible
      enabled: undefined,
      interactive: undefined,
    };

    // A control is verified against its name before its contents.
    //
    // `text()` on a combobox, a select or a filled text field returns the
    // *value*: `<mat-select>` for "Chuyển từ" reads back "TK Thường", the
    // account someone picked. Checking that against the expected label rejects
    // the correct element every single time, which is what it did — the right
    // control was found, was visible, opened its list when clicked, and was
    // thrown away on each of three attempts.
    //
    // Tried first and only ever used to *accept*: if the name does not match we
    // fall through to the original text check, so this can admit matches it
    // previously refused but can never refuse one it previously admitted.
    const name = await handle.accessibleName?.().catch(() => undefined);
    if (name) {
      if (this.verifier.verify(intent, { ...el, text: name }, []).checks.labelMatch !== false) {
        return true;
      }
    }

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

export function candidateKey(candidate: LocatorCandidate): string {
  return `${candidate.strategy}\u0000${candidate.value}\u0000${candidate.name ?? ''}`;
}

function instantiateCandidate(
  candidate: LocatorCandidate,
  params?: Record<string, string>,
): LocatorCandidate {
  if (!params || Object.keys(params).length === 0) return candidate;
  if (candidate.strategy === 'relative') {
    const spec = parseRelativeRowLocator(candidate.value);
    if (spec) {
      return {
        ...candidate,
        runtimeTemplateValue: candidate.value,
        value: formatRelativeRowLocator({
          ...spec,
          rowText: interpolateTemplate(spec.rowText, params),
          action: interpolateTemplate(spec.action, params),
        }),
      };
    }
  }
  return {
    ...candidate,
    runtimeTemplateValue: candidate.value,
    value: interpolateTemplate(candidate.value, params),
    ...(candidate.name ? { name: interpolateTemplate(candidate.name, params) } : {}),
  };
}

function interpolateTemplate(value: string, params?: Record<string, string>): string {
  if (!params) return value;
  return value.replace(/\{\{([A-Za-z][\w]*)\}\}/g, (whole, key: string) =>
    params[key] ?? whole,
  );
}

/** `Giá 1M` → `1M`, `Kỳ YTD` → `YTD`; ordinary words are never shortened. */
function compactOptionFromLabel(label: string): string | undefined {
  const tokens = label.match(/\b(?:\d+[A-Za-z%]+|[A-Za-z]+\d+[A-Za-z%]*|YTD|MTD|QTD|ALL)\b/gi) ?? [];
  return tokens.length === 1 && tokens[0]!.length < label.trim().length
    ? tokens[0]
    : undefined;
}

/**
 * Locates a compact control inside the business region asserted immediately
 * before it. Example:
 *
 *   "Các quỹ có thể bạn quan tâm" -> "Giá 1M"
 *
 * The live DOM renders `Giá` and `1M` as sibling spans in one table header.
 * Anchoring at the previous heading prevents the identically named `1M` chart
 * period elsewhere on the page from winning. If the descriptive prefix exists
 * as a sibling, click that prefix (the tooltip trigger); otherwise click the
 * compact option's parent control.
 */
function contextualCompactXPath(context: string, compact: string): string {
  const contextLit = xpathLiteral(context.trim());
  const compactLit = xpathLiteral(compact);
  const anchor = `//*[normalize-space(text())=${contextLit} or normalize-space(string(.))=${contextLit}]`;
  const region = `(${anchor})[1]/ancestor::*[` +
    `self::section or self::article or self::fieldset or starts-with(local-name(),'app-') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'table') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'card') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'panel') or ` +
    `contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'section')` +
    `][1]`;
  const optionParent = `${region}//*[not(*) and normalize-space(.)=${compactLit}]/parent::*`;
  return `(${optionParent})[1]`;
}
