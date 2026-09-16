import { refineLocator } from './locatorFromElement.js';
/**
 * Vision-based element discovery — item 20 (plan §11, §47.6).
 *
 * Last resort: called only when both deterministic AND semantic AI have failed.
 * Sends a screenshot to a vision-capable LLM and correlates the visual result
 * back to an ObservedElement for verification.
 *
 * Caller is responsible for budget checks (AgentStateMachine.trackAiCall(vision=true)).
 */

import type { ElementIntent } from '../ElementIntent.js';
import type { UiObservation, ObservedElement } from '../UiObservation.js';
import type { DiscoveryResult } from '../ElementDiscovery.js';
import type { RuntimeLocator } from '../RuntimeRegistry.js';
import { StandardElementVerifier } from '../ElementVerifier.js';
import { RuntimeRegistry } from '../RuntimeRegistry.js';
import type { VisionLlmProvider } from './AiDiscoveryTypes.js';
import { textMatch, type MatchScore } from '../ConfidenceScorer.js';
import { checkInteractionSafety } from '../InteractionSafety.js';
import { resolveActionElement } from './SemanticElementDiscovery.js';
import type { ElementMatch } from '../ElementMatcher.js';
import { normalizeHumanText } from '../../core/text.js';

export interface VisionDiscoveryOptions {
  /** Confidence floor for the vision candidate (default 60). */
  minConfidence?: number;
  /** Platform tag stored in registry on success. */
  platform?: string;
  /**
   * When true, attempt to correlate the vision result back to an ObservedElement
   * using bounding box overlap.  Requires `observation` to be provided.
   */
  correlateWithObservation?: boolean;
  /** Runtime resolver persists only after the action's observable outcome. */
  persistSuggestedLocator?: boolean;
  /** Permit an exact visible-text proxy only when outcome validation follows. */
  allowExactTextProxy?: boolean;
}

export class VisionElementDiscovery {
  private readonly verifier: StandardElementVerifier;

  constructor(
    private readonly visionLlm: VisionLlmProvider,
    private readonly registry: RuntimeRegistry,
  ) {
    this.verifier = new StandardElementVerifier();
  }

  /**
   * @param screenshotBase64 - PNG/JPEG encoded as base64
   * @param observation - Structured observation from the same frame (optional but recommended)
   */
  async discover(
    intent: ElementIntent,
    screenshotBase64: string,
    observation?: UiObservation,
    opts: VisionDiscoveryOptions = {},
  ): Promise<DiscoveryResult> {
    const evidence: string[] = [];
    const minConf = opts.minConfidence ?? 60;

    evidence.push(`[vision] querying vision LLM for intent "${intent.id}"`);

    // ── Vision LLM call ───────────────────────────────────────────────────────
    let response;
    try {
      response = await this.visionLlm.findElementInScreenshot(
        intent,
        screenshotBase64,
        observation,
      );
    } catch (err) {
      evidence.push(`[vision] LLM threw: ${(err as Error).message}`);
      return { intent, method: 'failed', observation, evidence };
    }

    if (response.modelId) evidence.push(`[vision] model=${response.modelId}`);
    if (response.tokensUsed != null) evidence.push(`[vision] tokens=${response.tokensUsed}`);
    if (response.description) evidence.push(`[vision] description: ${response.description}`);

    const proposals = [...(response.candidates ?? []), ...(response.candidate ? [response.candidate] : [])]
      .filter((candidate, index, all) =>
        all.findIndex((other) =>
          other.observedElementId === candidate.observedElementId &&
          other.clickableAncestorObservedElementId === candidate.clickableAncestorObservedElementId,
        ) === index)
      .slice(0, 3);
    if (proposals.length === 0) {
      evidence.push('[vision] LLM returned no candidate');
      return { intent, method: 'failed', observation, evidence };
    }
    if (!observation) {
      evidence.push('[vision] no observation available for correlation or verification');
      return { intent, method: 'failed', evidence };
    }

    const accepted: Array<{
      match: ElementMatch;
      locator: { strategy: string; value: string };
      verification: ReturnType<StandardElementVerifier['verify']>;
      safety: ReturnType<typeof checkInteractionSafety>;
    }> = [];

    for (const [rank, candidate] of proposals.entries()) {
      evidence.push(
        `[vision] candidate #${rank + 1} elementId=${candidate.observedElementId} confidence=${candidate.confidence}`,
      );
      evidence.push(`[vision] reasoning: ${candidate.reasoning}`);
      if (candidate.confidence < minConf) {
        evidence.push(`[vision] candidate #${rank + 1} below threshold ${minConf} — rejected`);
        continue;
      }

      let el = observation.elements.find((item) => item.id === candidate.observedElementId);
      const bounds = candidate.visualBounds ?? (rank === 0 ? response.bounds : undefined);
      if (!el && bounds) {
        el = findByBoundsOverlap(observation.elements, bounds);
        if (el) evidence.push(`[vision] candidate #${rank + 1} correlated to ${el.id} via bounds`);
      }
      if (!el) {
        evidence.push(`[vision] candidate #${rank + 1} could not correlate to a real observed node`);
        continue;
      }

      // The model must identify what it actually saw, not merely return a node
      // id. This allows screenshot text to fill accessibility gaps while still
      // rejecting a visually unrelated but clickable node.
      const wanted = intent.text ?? intent.label;
      const treeText = el.accessibilityLabel ?? el.text ?? el.placeholder ?? '';
      const treeSemanticMatch = wanted ? textMatch(treeText, wanted) !== 'none' : true;
      const visualSemanticMatch = wanted && candidate.visualText
        ? textMatch(candidate.visualText, wanted) !== 'none'
        : false;
      const visualIdentity = candidate.visualDescription ?? candidate.reasoning;
      // Icon-only controls have no useful UI-tree text and often no literal
      // screenshot text either. Accept Gemini's semantic description only as
      // a provisional identity when it is tied to a bounded live node, is
      // high-confidence, and the caller promises an observable postcondition.
      // The locator is still not persisted until that outcome succeeds.
      const boundedVisualIdentity = Boolean(
        wanted &&
        opts.allowExactTextProxy === true &&
        candidate.confidence >= 80 &&
        el.bounds &&
        visualIdentity &&
        semanticDescriptionMatch(visualIdentity, wanted),
      );
      if (wanted && !treeSemanticMatch && !visualSemanticMatch && !boundedVisualIdentity) {
        evidence.push(
          `[vision] candidate #${rank + 1} rejected: neither UI-tree text "${treeText || '(empty)'}" ` +
          `nor visual evidence "${candidate.visualText ?? visualIdentity ?? '(missing)'}" matches "${wanted}"`,
        );
        continue;
      }
      if (visualSemanticMatch && !treeSemanticMatch) {
        evidence.push(
          `[vision] candidate #${rank + 1} visual text "${candidate.visualText}" supplements UI-tree text "${treeText || '(empty)'}"`,
        );
      }
      if (boundedVisualIdentity && !treeSemanticMatch && !visualSemanticMatch) {
        evidence.push(
          `[vision] candidate #${rank + 1} uses bounded icon identity "${visualIdentity}" ` +
          'provisionally; the action outcome must verify before persistence',
        );
      }

      const actionEl = resolveActionElement(
        candidate.clickableAncestorObservedElementId,
        el,
        observation,
      );
      const verificationEl = actionEl === el ? actionEl : {
        ...actionEl,
        text: el.text ?? actionEl.text,
        accessibilityLabel: el.accessibilityLabel ?? actionEl.accessibilityLabel,
      };
      const verifyOpts = {
        allowExactTextProxy: opts.allowExactTextProxy === true,
        ...(visualSemanticMatch && candidate.visualText
          ? { visualTextEvidence: candidate.visualText }
          : {}),
      };
      const safety = checkInteractionSafety(intent, verificationEl, observation.elements, verifyOpts);
      if (safety.safety !== 'SAFE') {
        evidence.push(`[vision] candidate #${rank + 1} safety=${safety.safety}: ${safety.reason}`);
        continue;
      }
      const verification = this.verifier.verify(intent, verificationEl, observation.elements, verifyOpts);
      evidence.push(
        `[vision] candidate #${rank + 1} verification: ${verification.passed ? 'PASSED' : 'FAILED'} score=${verification.score}`,
      );
      for (const line of verification.evidence) evidence.push(`  · ${line}`);
      if (!verification.passed) continue;

      const locator = refineLocator(actionEl, candidate.suggestedLocator);
      if (!locator) {
        evidence.push(`[vision] candidate #${rank + 1} has no usable locator`);
        continue;
      }
      accepted.push({
        locator,
        verification,
        safety,
        match: {
          intentId: intent.id,
          observedElementId: actionEl.id,
          confidence: candidate.confidence,
          method: 'vision',
          reasons: [candidate.reasoning],
          penalties: [],
          verified: true,
          locator,
          score: aiMatchScore(actionEl.id, candidate.confidence, candidate.reasoning),
        },
      });
    }

    const best = accepted[0];
    if (!best) return { intent, method: 'failed', observation, evidence };

    // ── Store in registry ─────────────────────────────────────────────────────
    if (opts.persistSuggestedLocator !== false) {
      const loc: RuntimeLocator = {
        strategy: best.locator.strategy,
        value: best.locator.value,
        source: 'ai-discovered',   // vision result treated as AI-sourced
        status: 'suggested',
        confidence: best.match.confidence / 100,
        verifiedAt: new Date().toISOString(),
        ...(opts.platform ? { platform: opts.platform } : {}),
      };
      this.registry.upsertLocator(intent.id, loc);
      evidence.push(`[vision] stored: ${best.locator.strategy}="${best.locator.value}" status=suggested`);
    }

    return {
      intent,
      method: 'vision',
      locator: best.locator,
      match: best.match,
      ...(accepted.length > 1 ? { alternatives: accepted.slice(1).map((item) => item.match) } : {}),
      verification: best.verification,
      safety: best.safety,
      observation,
      evidence,
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function aiMatchScore(candidateId: string, confidence: number, reasoning: string): MatchScore {
  return { candidateId, score: confidence, reasons: [reasoning], penalties: [] };
}

/**
 * A visual description is prose, so inserting a shape between business words
 * ("nút 3 dấu chấm tùy chọn dòng") must not make it less equivalent to the
 * concise intent ("nút tùy chọn dòng"). Require every meaningful intent word;
 * this is containment, not fuzzy guessing.
 */
function semanticDescriptionMatch(description: string, wanted: string): boolean {
  if (textMatch(description, wanted) !== 'none') return true;
  const stop = new Set(['nut', 'button', 'icon', 'control', 'phan', 'tu', 'element']);
  const words = (value: string) => normalizeHumanText(value)
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !stop.has(word));
  const expected = [...new Set(words(wanted))];
  if (expected.length < 2) return false;
  const actual = new Set(words(description));
  return expected.every((word) => actual.has(word));
}


/**
 * Find the element whose bounding box overlaps most with the vision result bounds.
 * Uses intersection-over-union (IoU) — minimum threshold 0.3.
 */
function findByBoundsOverlap(
  elements: ObservedElement[],
  target: { x: number; y: number; width: number; height: number },
): ObservedElement | undefined {
  let best: ObservedElement | undefined;
  let bestIou = 0.3; // minimum threshold

  for (const el of elements) {
    if (!el.bounds) continue;
    const iou = computeIou(el.bounds, target);
    if (iou > bestIou) {
      bestIou = iou;
      best = el;
    }
  }

  return best;
}

type Rect = { x: number; y: number; width: number; height: number };

function computeIou(a: Rect, b: Rect): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;

  if (intersection === 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const union = aArea + bArea - intersection;

  return union === 0 ? 0 : intersection / union;
}
