/**
 * Semantic AI element discovery — item 19 (plan §47.6, §12).
 *
 * Called after deterministic discovery fails.  Sends the structured UiObservation
 * (not a screenshot) to an LLM and asks it to pick the best matching element.
 * The LLM's choice is always verified by ElementVerifier before it is accepted.
 *
 * Caller is responsible for budget checks (AgentStateMachine.trackAiCall()).
 */

import type { ElementIntent } from '../ElementIntent.js';
import type { UiObservation } from '../UiObservation.js';
import type { DiscoveryResult, ObservationProvider } from '../ElementDiscovery.js';
import type { RuntimeLocator } from '../RuntimeRegistry.js';
import { StandardElementVerifier } from '../ElementVerifier.js';
import { RuntimeRegistry } from '../RuntimeRegistry.js';
import type { LlmProvider } from './AiDiscoveryTypes.js';
import type { MatchScore } from '../ConfidenceScorer.js';

export interface SemanticDiscoveryOptions {
  /** Confidence floor — AI candidates below this are rejected (default 60). */
  minConfidence?: number;
  /** Platform tag stored in the registry on success. */
  platform?: string;
}

/**
 * Uses a LlmProvider to find an element when the deterministic pipeline returns
 * method='failed' or a below-threshold match.
 *
 * Requires an existing UiObservation — it does NOT call observe() itself.
 * Pass the observation captured in the prior deterministic step so we don't
 * waste an extra Appium call.
 */
export class SemanticElementDiscovery {
  private readonly verifier: StandardElementVerifier;

  constructor(
    private readonly llm: LlmProvider,
    private readonly registry: RuntimeRegistry,
  ) {
    this.verifier = new StandardElementVerifier();
  }

  async discover(
    intent: ElementIntent,
    observation: UiObservation,
    opts: SemanticDiscoveryOptions = {},
  ): Promise<DiscoveryResult> {
    const evidence: string[] = [];
    const minConf = opts.minConfidence ?? 60;

    evidence.push(`[semantic-ai] querying LLM for intent "${intent.id}"`);

    // ── LLM call ──────────────────────────────────────────────────────────────
    let response;
    try {
      response = await this.llm.findElement(intent, observation);
    } catch (err) {
      evidence.push(`[semantic-ai] LLM threw: ${(err as Error).message}`);
      return { intent, method: 'failed', observation, evidence };
    }

    if (response.modelId) evidence.push(`[semantic-ai] model=${response.modelId}`);
    if (response.tokensUsed != null) evidence.push(`[semantic-ai] tokens=${response.tokensUsed}`);

    const candidate = response.candidate;
    if (!candidate) {
      evidence.push('[semantic-ai] LLM returned no candidate');
      return { intent, method: 'failed', observation, evidence };
    }

    evidence.push(
      `[semantic-ai] candidate elementId=${candidate.observedElementId} confidence=${candidate.confidence}`,
    );
    evidence.push(`[semantic-ai] reasoning: ${candidate.reasoning}`);

    // ── Confidence threshold ──────────────────────────────────────────────────
    if (candidate.confidence < minConf) {
      evidence.push(
        `[semantic-ai] confidence ${candidate.confidence} below threshold ${minConf} — rejected`,
      );
      return { intent, method: 'failed', observation, evidence };
    }

    // ── Resolve observed element ──────────────────────────────────────────────
    const el = observation.elements.find((e) => e.id === candidate.observedElementId);
    if (!el) {
      evidence.push(
        `[semantic-ai] candidate observedElementId="${candidate.observedElementId}" not in observation`,
      );
      return { intent, method: 'failed', observation, evidence };
    }

    // ── Verification ──────────────────────────────────────────────────────────
    const verification = this.verifier.verify(intent, el, observation.elements);
    evidence.push(
      `[semantic-ai] verification: ${verification.passed ? 'PASSED' : 'FAILED'} score=${verification.score}`,
    );
    for (const line of verification.evidence) evidence.push(`  · ${line}`);

    const locator = candidate.suggestedLocator ?? deriveLocator(el);

    if (!verification.passed) {
      return {
        intent,
        method: 'semantic-ai',
        locator,
        match: {
          intentId: intent.id,
          observedElementId: el.id,
          confidence: candidate.confidence,
          method: 'semantic-ai',
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
        source: 'ai-discovered',
        status: 'suggested',
        confidence: candidate.confidence / 100,
        verifiedAt: new Date().toISOString(),
        ...(opts.platform ? { platform: opts.platform } : {}),
      };
      this.registry.upsertLocator(intent.id, loc);
      evidence.push(`[semantic-ai] stored: ${locator.strategy}="${locator.value}" status=suggested`);
    }

    return {
      intent,
      method: 'semantic-ai',
      locator,
      match: {
        intentId: intent.id,
        observedElementId: el.id,
        confidence: candidate.confidence,
        method: 'semantic-ai',
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

function aiMatchScore(candidateId: string, confidence: number, reasoning: string): MatchScore {
  return { candidateId, score: confidence, reasons: [reasoning], penalties: [] };
}

// ── helpers ───────────────────────────────────────────────────────────────────

import type { ObservedElement } from '../UiObservation.js';

/**
 * Derive a stable locator from the element's attributes, in priority order.
 * Falls back to xpath as a last resort.
 */
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
