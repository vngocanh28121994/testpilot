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
import { textMatch, type MatchScore } from '../ConfidenceScorer.js';
import { normalizeHumanText } from '../../core/text.js';

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

    // ── Guard written for AI answers specifically ─────────────────────────────
    // The shared verifier accepts a *substring* label match, which is right for
    // a locator someone authored and wrong for a guess: asked for "Lệnh thường"
    // the model picked a control reading "Thường" — a different field entirely —
    // with confidence 90, and the substring rule waved it through. A model is
    // fluent enough to make a wrong answer look plausible, so its answers are
    // held to what a human reading the screen would accept.
    const objection = aiAnswerObjection(intent, el);
    if (objection) {
      evidence.push(`[semantic-ai] từ chối: ${objection}`);
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
/**
 * Phần tử này có phải một ô nhập không.
 *
 * Xét cả vai trò web (`input`, `textarea`) lẫn native (`EditText`,
 * `XCUIElementTypeTextField`): cùng một bộ discovery chạy trên cả hai, và một
 * ô nhập ở đâu thì cũng là ô nhập.
 */
function isField(el: ObservedElement): boolean {
  const role = (el.role ?? '').toLowerCase();
  return /input|textarea|textbox|searchfield|edittext|textfield|securetextfield/.test(role);
}

export function deriveLocator(
  el: ObservedElement,
): { strategy: string; value: string } | undefined {
  if (el.testId) return { strategy: 'testId', value: el.testId };
  if (el.resourceId) return { strategy: 'resourceId', value: el.resourceId };
  if (el.accessibilityLabel) return { strategy: 'label', value: el.accessibilityLabel };
  // Với MỘT Ô NHẬP, chuỗi nhìn thấy chính là placeholder — phải khai đúng như
  // vậy, đừng khai là chữ.
  //
  // Cây native của Android phơi hint của một EditText rỗng ra ở thuộc tính
  // `text`, nên chỗ này thấy `text = "TCB,VNM,FPT…"` và chọn khớp-theo-chữ.
  // Nhưng app là hybrid: bước resolve chạy trong WebView, nơi `label` khớp chữ
  // hiển thị hoặc aria-label — mà placeholder không phải hai thứ đó. Kết quả là
  // một locator đúng phần tử, đúng chuỗi, và không bao giờ khớp.
  //
  // Đo trên máy thật: AI tìm đúng ô mã cổ phiếu với tin cậy 85, rồi cả kịch bản
  // vẫn đỏ ở đúng bước đó.
  if (el.placeholder && isField(el)) {
    return { strategy: 'placeholder', value: el.placeholder };
  }
  if (el.text) return { strategy: 'text', value: el.text };
  // A form field often has neither an id nor any words of its own — the caption
  // that names it lives in a sibling <legend>. Without these two the model could
  // identify the right input and still produce nothing usable, which is exactly
  // how the first wired run ended: "verification PASSED" and no locator.
  if (el.placeholder) return { strategy: 'placeholder', value: el.placeholder };
  if (el.css) return { strategy: 'css', value: el.css };
  if (el.xpath) return { strategy: 'xpath', value: el.xpath };
  return undefined;
}

/**
 * Why an AI answer should not be trusted, or undefined when it may proceed.
 *
 * The tier only runs because the element's own words did NOT match the label —
 * that is what deterministic matching already tried. So demanding they match
 * here rejects every answer worth having: asked for "Giá đặt" the model
 * correctly returns `<input name="price">`, whose only readable word is English.
 *
 * What can be judged is the *shape* of a wrong answer. Two rules, both from
 * answers that were wrong in practice:
 *
 * 1. A typing step must land on something that holds a value.
 *
 * 2. Sharing some words with the label while missing the word the label is
 *    *about* is the signature of a confusion, not a match. Asked for
 *    "Lệnh thường" the model picked a control reading "Thường" — the value of a
 *    different field — and one shared word made it look plausible. The same
 *    head-word test the locator layer uses separates that from "Nhập mã"
 *    answering for "Ô nhập mã cổ phiếu", which shares words *and* the head.
 *
 * An element sharing no words at all is left alone: no overlap means the model
 * reasoned structurally, which is the whole reason to ask it.
 */
function aiAnswerObjection(intent: ElementIntent, el: ObservedElement): string | undefined {
  if (intent.action === 'input' || intent.action === 'select') {
    const role = (el.role ?? '').toLowerCase();
    const holdsValue = /input|textarea|textbox|combobox|searchbox|spinbutton|select/.test(role);
    if (!holdsValue && el.interactive !== true) {
      return `bước ${intent.action} nhưng phần tử (role=${el.role ?? '?'}) không nhận được dữ liệu`;
    }
  }

  const wanted = intent.text ?? intent.label ?? '';
  if (!wanted.trim()) return undefined;

  for (const value of [el.accessibilityLabel, el.placeholder, el.text]) {
    if (!value?.trim()) continue;
    if (textMatch(value, wanted) !== 'none') return undefined;  // khớp hợp lệ
    if (sharesAWord(value, wanted)) {
      return `chữ trên phần tử ("${value.trim().slice(0, 40)}") trùng một phần nhưng trật ý của "${wanted}"`;
    }
  }
  return undefined;
}

function sharesAWord(a: string, b: string): boolean {
  const words = (t: string) => new Set(normalizeHumanText(t).split(/\s+/).filter(Boolean));
  const left = words(a);
  return [...words(b)].some((w) => left.has(w));
}
