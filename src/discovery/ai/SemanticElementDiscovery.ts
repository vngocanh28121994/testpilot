import {
  deriveLocator,
  refineLocator,
} from './locatorFromElement.js';
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
import type { DiscoveryResult } from '../ElementDiscovery.js';
import type { RuntimeLocator } from '../RuntimeRegistry.js';
import { StandardElementVerifier } from '../ElementVerifier.js';
import { RuntimeRegistry } from '../RuntimeRegistry.js';
import type { LlmProvider } from './AiDiscoveryTypes.js';
import { textMatch, type MatchScore } from '../ConfidenceScorer.js';
import { normalizeHumanText } from '../../core/text.js';
import { checkInteractionSafety } from '../InteractionSafety.js';
import type { ElementMatch } from '../ElementMatcher.js';

export interface SemanticDiscoveryOptions {
  /** Confidence floor — AI candidates below this are rejected (default 60). */
  minConfidence?: number;
  /** Platform tag stored in the registry on success. */
  platform?: string;
  /** Runtime resolver owns persistence after an observable action outcome. */
  persistSuggestedLocator?: boolean;
  /** Permit an exact visible text leaf when the executor can verify the outcome. */
  allowExactTextProxy?: boolean;
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

    const proposals = [...(response.candidates ?? []), ...(response.candidate ? [response.candidate] : [])]
      .filter((candidate, index, all) =>
        all.findIndex((other) => other.observedElementId === candidate.observedElementId) === index)
      .slice(0, 3);
    if (proposals.length === 0) {
      evidence.push('[semantic-ai] LLM returned no candidates');
      return { intent, method: 'failed', observation, evidence };
    }

    const accepted: Array<{
      match: ElementMatch;
      locator: { strategy: string; value: string };
      verification: ReturnType<StandardElementVerifier['verify']>;
      safety: ReturnType<typeof checkInteractionSafety>;
    }> = [];

    for (const [rank, candidate] of proposals.entries()) {
      evidence.push(
        `[semantic-ai] candidate #${rank + 1} elementId=${candidate.observedElementId} confidence=${candidate.confidence}`,
      );
      evidence.push(`[semantic-ai] reasoning: ${candidate.reasoning}`);
      if (candidate.confidence < minConf) {
        evidence.push(`[semantic-ai] candidate #${rank + 1} below threshold ${minConf} — rejected`);
        continue;
      }

      const semanticEl = observation.elements.find((e) => e.id === candidate.observedElementId);
      if (!semanticEl) {
        evidence.push(`[semantic-ai] candidate #${rank + 1} is not in the observation — rejected`);
        continue;
      }
      const objection = aiAnswerObjection(intent, semanticEl);
      if (objection) {
        evidence.push(`[semantic-ai] candidate #${rank + 1} từ chối: ${objection}`);
        continue;
      }

      const actionEl = resolveActionElement(candidate.clickableAncestorObservedElementId, semanticEl, observation);
      if (candidate.clickableAncestorObservedElementId && actionEl === semanticEl) {
        evidence.push(`[semantic-ai] clickable ancestor không chứng minh được quan hệ cha–con — dùng chính node đã chọn`);
      } else if (actionEl !== semanticEl) {
        evidence.push(`[semantic-ai] action target ${actionEl.id} owns semantic leaf ${semanticEl.id}`);
      }
      const verificationEl = actionEl === semanticEl ? actionEl : {
        ...actionEl,
        text: semanticEl.text ?? actionEl.text,
        accessibilityLabel: semanticEl.accessibilityLabel ?? actionEl.accessibilityLabel,
      };
      const verifyOpts = { allowExactTextProxy: opts.allowExactTextProxy === true };
      const safety = checkInteractionSafety(intent, verificationEl, observation.elements, verifyOpts);
      if (safety.safety !== 'SAFE') {
        evidence.push(`[semantic-ai] candidate #${rank + 1} safety=${safety.safety}: ${safety.reason}`);
        continue;
      }
      const verification = this.verifier.verify(intent, verificationEl, observation.elements, verifyOpts);
      evidence.push(
        `[semantic-ai] candidate #${rank + 1} verification: ${verification.passed ? 'PASSED' : 'FAILED'} score=${verification.score}`,
      );
      if (!verification.passed) continue;
      const locator = refineLocator(actionEl, candidate.suggestedLocator);
      if (!locator) {
        evidence.push(`[semantic-ai] candidate #${rank + 1} has no usable locator`);
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
          method: 'semantic-ai',
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
        source: 'ai-discovered',
        status: 'suggested',
        confidence: best.match.confidence / 100,
        verifiedAt: new Date().toISOString(),
        ...(opts.platform ? { platform: opts.platform } : {}),
      };
      this.registry.upsertLocator(intent.id, loc);
      evidence.push(`[semantic-ai] stored: ${best.locator.strategy}="${best.locator.value}" status=suggested`);
    }

    return {
      intent,
      method: 'semantic-ai',
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
 *
 * Luật 2 chỉ có nghĩa với phần tử LÁ, nơi chữ trên phần tử chính là danh tính
 * của nó. Chữ của một container là chữ của cả cây con nối lại, nên nó chia sẻ
 * chữ với gần như mọi nhãn nói về thứ nằm bên trong nó — và "chia sẻ chữ" lúc
 * ấy là dấu hiệu model tìm TRÚNG VÙNG, không phải dấu hiệu nhầm.
 *
 * Đo trên máy thật 2026-09-16, android, popup "Thêm thẻ": hỏi "Nút đóng popup
 * Thêm thẻ", model trả về mat-dialog-container của đúng popup ấy và nói rõ
 * trong reasoning. Chữ của container gồm cả "Thêm thẻ" lẫn "Đóng", chia sẻ ba
 * chữ `dong / them / the` với nhãn, nên luật 2 kết luận "nhầm lẫn" và từ chối
 * ứng viên duy nhất có được. Sau đó tầng vision hết giờ, và bước ấy hỏng.
 *
 * `container` đã được thêm vào ObservedElement từ 2026-09-15 vì đúng lớp lỗi
 * này; ConfidenceScorer và ElementMatcher đã đọc nó, riêng chỗ này thì chưa.
 * Theo đúng quy ước của hai chỗ kia: chỉ `=== true` mới bỏ qua luật, còn thiếu
 * thông tin thì im lặng và giữ nguyên hành vi cũ.
 */
export function aiAnswerObjection(
  intent: ElementIntent,
  el: ObservedElement,
): string | undefined {
  if (intent.action === 'input' || intent.action === 'select') {
    const role = (el.role ?? '').toLowerCase();
    const holdsValue = /input|textarea|textbox|combobox|searchbox|spinbutton|select/.test(role);
    if (!holdsValue && el.interactive !== true) {
      return `bước ${intent.action} nhưng phần tử (role=${el.role ?? '?'}) không nhận được dữ liệu`;
    }
  }

  const wanted = intent.text ?? intent.label ?? '';
  if (!wanted.trim()) return undefined;

  // Chữ của container là chữ của cả cây con, nên phép so chữ dưới đây không nói
  // được gì về danh tính của chính nó.
  if (el.container === true) return undefined;

  for (const value of [el.accessibilityLabel, el.placeholder, el.text]) {
    if (!value?.trim()) continue;
    if (textMatch(value, wanted) !== 'none') return undefined;  // khớp hợp lệ
    if (sharesAWord(value, wanted)) {
      // Kèm `container` vào câu từ chối. Luật này bỏ qua container, nên khi một
      // ứng viên vẫn bị từ chối thì câu hỏi đầu tiên luôn là "nó có được đánh
      // dấu container không" — mà trước đây log không trả lời được, và phải
      // đoán qua hai lượt chạy máy thật mới biết.
      return `chữ trên phần tử ("${value.trim().slice(0, 40)}", container=${el.container ?? '?'}) `
        + `trùng một phần nhưng trật ý của "${wanted}"`;
    }
  }
  return undefined;
}

function sharesAWord(a: string, b: string): boolean {
  const words = (t: string) => new Set(normalizeHumanText(t).split(/\s+/).filter(Boolean));
  const left = words(a);
  return [...words(b)].some((w) => left.has(w));
}

export function resolveActionElement(
  ancestorId: string | undefined,
  semanticEl: ObservedElement,
  observation: UiObservation,
): ObservedElement {
  if (!ancestorId) return semanticEl;
  const ancestor = observation.elements.find((element) => element.id === ancestorId);
  if (!ancestor || ancestor.visible === false || ancestor.enabled === false) return semanticEl;
  if (!isAncestorOf(ancestor, semanticEl, observation.elements)) return semanticEl;
  return ancestor;
}

function isAncestorOf(
  ancestor: ObservedElement,
  child: ObservedElement,
  elements: ObservedElement[],
): boolean {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let cursor = child.parentId ? byId.get(child.parentId) : undefined;
  while (cursor) {
    if (cursor.id === ancestor.id) return true;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (!ancestor.bounds || !child.bounds) return false;
  const ax2 = ancestor.bounds.x + ancestor.bounds.width;
  const ay2 = ancestor.bounds.y + ancestor.bounds.height;
  const cx2 = child.bounds.x + child.bounds.width;
  const cy2 = child.bounds.y + child.bounds.height;
  return ancestor.bounds.x <= child.bounds.x
    && ancestor.bounds.y <= child.bounds.y
    && ax2 >= cx2
    && ay2 >= cy2;
}
