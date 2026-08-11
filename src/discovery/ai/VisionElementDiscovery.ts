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
import type { MatchScore } from '../ConfidenceScorer.js';

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

    const candidate = response.candidate;
    if (!candidate) {
      evidence.push('[vision] LLM returned no candidate');
      return { intent, method: 'failed', observation, evidence };
    }

    evidence.push(
      `[vision] candidate elementId=${candidate.observedElementId} confidence=${candidate.confidence}`,
    );
    evidence.push(`[vision] reasoning: ${candidate.reasoning}`);

    // ── Confidence threshold ──────────────────────────────────────────────────
    if (candidate.confidence < minConf) {
      evidence.push(
        `[vision] confidence ${candidate.confidence} below threshold ${minConf} — rejected`,
      );
      return { intent, method: 'failed', observation, evidence };
    }

    // ── Correlate with observation ────────────────────────────────────────────
    let el: ObservedElement | undefined;

    if (observation && candidate.observedElementId) {
      el = observation.elements.find((e) => e.id === candidate.observedElementId);
    }

    // If element ID didn't match directly, try bounds correlation
    if (!el && observation && response.bounds) {
      el = findByBoundsOverlap(observation.elements, response.bounds);
      if (el) {
        evidence.push(`[vision] correlated to element ${el.id} via bounds overlap`);
      }
    }

    if (!el) {
      if (observation) {
        evidence.push('[vision] could not correlate vision result to any observed element');
        // Without a verified element, we cannot safely return a locator
        return { intent, method: 'failed', observation, evidence };
      }
      // No observation at all — create a synthetic placeholder for evidence only
      evidence.push('[vision] no observation available for correlation or verification');
      return { intent, method: 'failed', evidence };
    }

    // ── Verification ──────────────────────────────────────────────────────────
    const verification = this.verifier.verify(intent, el, observation?.elements ?? []);
    evidence.push(
      `[vision] verification: ${verification.passed ? 'PASSED' : 'FAILED'} score=${verification.score}`,
    );
    for (const line of verification.evidence) evidence.push(`  · ${line}`);

    const locator = candidate.suggestedLocator ?? deriveLocator(el);

    if (!verification.passed) {
      return {
        intent,
        method: 'vision',
        locator,
        match: {
          intentId: intent.id,
          observedElementId: el.id,
          confidence: candidate.confidence,
          method: 'vision',
          reasons: [candidate.reasoning],
          penalties: [],
          verified: false,
          locator,
          score: aiMatchScore(candidate.observedElementId, candidate.confidence, candidate.reasoning),
        },
        verification,
        observation,
        evidence,
      };
    }

    // ── Store in registry ─────────────────────────────────────────────────────
    if (locator) {
      const loc: RuntimeLocator = {
        strategy: locator.strategy,
        value: locator.value,
        source: 'ai-discovered',   // vision result treated as AI-sourced
        status: 'suggested',
        confidence: candidate.confidence / 100,
        verifiedAt: new Date().toISOString(),
        ...(opts.platform ? { platform: opts.platform } : {}),
      };
      this.registry.upsertLocator(intent.id, loc);
      evidence.push(`[vision] stored: ${locator.strategy}="${locator.value}" status=suggested`);
    }

    return {
      intent,
      method: 'vision',
      locator,
      match: {
        intentId: intent.id,
        observedElementId: el.id,
        confidence: candidate.confidence,
        method: 'vision',
        reasons: [candidate.reasoning],
        penalties: [],
        verified: true,
        locator,
        score: aiMatchScore(candidate.observedElementId, candidate.confidence, candidate.reasoning),
      },
      verification,
      observation,
      evidence,
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function aiMatchScore(candidateId: string, confidence: number, reasoning: string): MatchScore {
  return { candidateId, score: confidence, reasons: [reasoning], penalties: [] };
}

function deriveLocator(
  el: ObservedElement,
): { strategy: string; value: string } | undefined {
  if (el.testId) return { strategy: 'testId', value: el.testId };
  if (el.resourceId) return { strategy: 'resourceId', value: el.resourceId };
  if (el.accessibilityLabel) return { strategy: 'label', value: el.accessibilityLabel };
  if (el.text) return { strategy: 'text', value: el.text };
  if (el.xpath) return { strategy: 'xpath', value: el.xpath };
  return undefined;
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
