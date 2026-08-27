/**
 * The LlmProvider the semantic tier was written against but never had.
 *
 * Called only after every deterministic candidate has failed — roughly 2.4% of
 * lookups on the current suite — so its cost is paid per stuck element, not per
 * step. What it buys, measured against captured screens: labels that describe a
 * field rather than quote it ("Ô nhập mã cổ phiếu" for `placeholder="Nhập mã"`),
 * and messages that carry their own data ("Đã lưu lệnh Mua TCB 28000 x 100…").
 * Both are unreachable by text matching however it is spelled.
 *
 * The observation is sent as text, not as a screenshot: it already carries
 * resourceId, css, bounds and the interactive flag, which is more than a
 * rendered image can show and far cheaper to send.
 */

import { completeJson, llmAvailable, pickModel } from '../../llm/client.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement, UiObservation } from '../UiObservation.js';
import type { LlmProvider, SemanticDiscoveryResponse } from './AiDiscoveryTypes.js';

/**
 * How many elements of a screen to describe.
 *
 * A busy screen observes 400+ nodes; sending all of them is mostly whitespace
 * and layout containers. Interactive and text-bearing nodes come first, and the
 * rest are dropped rather than truncated mid-list, so the model never sees half
 * an element.
 */
const MAX_ELEMENTS = 120;

export class LlmElementProvider implements LlmProvider {
  constructor(
    private readonly model: string = pickModel('auto'),
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** Whether any vendor key is configured. Callers skip the tier when false. */
  static available(): boolean {
    return llmAvailable();
  }

  async findElement(
    intent: ElementIntent,
    observation: UiObservation,
  ): Promise<SemanticDiscoveryResponse> {
    const shortlist = shortlistFor(intent, observation.elements);
    if (shortlist.length === 0) return { modelId: this.model };

    const raw = await completeJson({
      model: this.model,
      system: SYSTEM,
      user: promptFor(intent, shortlist, observation.elements),
      maxTokens: 400,
      // Cùng một màn hình phải cho cùng một câu trả lời.
      temperature: 0,
    });

    const parsed = parseChoice(raw);
    if (!parsed || parsed.index < 0 || parsed.index >= shortlist.length) {
      this.log(`[semantic-ai] không chọn được: ${raw.slice(0, 120)}`);
      return { modelId: this.model };
    }

    const picked = shortlist[parsed.index]!;
    return {
      candidate: {
        observedElementId: picked.id,
        confidence: clampConfidence(parsed.confidence),
        reasoning: parsed.reason,
      },
      modelId: this.model,
    };
  }
}

const SYSTEM = [
  'Bạn chọn một phần tử UI cho một bước kiểm thử tự động.',
  'Chỉ trả về JSON, không giải thích ngoài JSON.',
  'Quy tắc bắt buộc:',
  '- Bước INPUT/SELECT phải trỏ vào ô nhập được dữ liệu, KHÔNG phải nhãn mô tả ô đó.',
  '- Bước TAP phải trỏ vào phần tử bấm được, không phải đoạn văn bản tĩnh.',
  '- Nếu không có phần tử nào thực sự đúng, trả index -1. Đoán bừa tệ hơn là không trả lời.',
].join('\n');

/**
 * Candidates worth describing, most likely first.
 *
 * Ordering matters more than it looks: the cut at MAX_ELEMENTS falls at the end
 * of this list, so anything ranked low is what gets dropped.
 */
function shortlistFor(intent: ElementIntent, all: ObservedElement[]): ObservedElement[] {
  const usable = all.filter((e) => e.visible && describes(e));
  const wantsInput = intent.action === 'input' || intent.action === 'select';
  const rank = (e: ObservedElement): number => {
    let score = 0;
    if (e.interactive) score += 2;
    if (wantsInput && /input|textbox|combobox|searchbox|textarea|select/i.test(e.role ?? '')) score += 3;
    if (e.testId || e.resourceId) score += 1;
    if (e.accessibilityLabel || e.placeholder) score += 1;
    return score;
  };
  return [...usable].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_ELEMENTS);
}

/** An element with nothing readable about it cannot be chosen on evidence. */
function describes(e: ObservedElement): boolean {
  return Boolean(
    e.text?.trim() || e.accessibilityLabel || e.placeholder || e.testId || e.resourceId || e.role,
  );
}

function promptFor(
  intent: ElementIntent,
  elements: ObservedElement[],
  all: ObservedElement[],
): string {
  const listing = elements
    .map((e, i) => `#${i} ${describe(e)}${nearbyText(e, all)}`)
    .join('\n');
  return [
    `Hành động: ${intent.action.toUpperCase()}`,
    `Phần tử cần tìm, người viết kịch bản gọi là: "${intent.label ?? intent.id}"`,
    intent.screen ? `Màn hình: ${intent.screen}` : '',
    intent.context?.length ? `Ngữ cảnh kịch bản: ${intent.context.join(' → ')}` : '',
    '',
    'Các phần tử đang hiển thị:',
    listing,
    '',
    'Trả JSON: {"index": <số sau dấu #>, "confidence": <0-100>, "reason": "<một câu>"}',
    'Không có phần tử đúng thì trả {"index": -1, "confidence": 0, "reason": "..."}',
  ].filter(Boolean).join('\n');
}

function describe(e: ObservedElement): string {
  return [
    e.role ? `role=${e.role}` : '',
    e.resourceId ? `name=${e.resourceId}` : '',
    e.testId ? `testid=${e.testId}` : '',
    e.accessibilityLabel ? `aria="${trim(e.accessibilityLabel, 60)}"` : '',
    e.placeholder ? `placeholder="${trim(e.placeholder, 40)}"` : '',
    e.text?.trim() ? `text="${trim(e.text.trim(), 90)}"` : '',
    e.attributes?.region ? `region="${trim(e.attributes.region, 80)}"` : '',
    e.interactive ? 'bấm-được' : '',
    e.enabled === false ? 'disabled' : '',
  ].filter(Boolean).join(' ');
}

/**
 * The caption printed beside a control, as a person would read it.
 *
 * Without it the model is guessing from attribute names: `name="price"` reads
 * as "Giá đặt" to anyone, while `name="volume"` for "KL đặt" does not, and that
 * single asymmetry decided which of the two it could find. A form is legible
 * because its labels sit next to its fields, so the label is what gets sent.
 *
 * Chosen by geometry rather than by DOM ancestry: a legend, a floating label
 * and a caption in a sibling column all end up in the same place on screen and
 * in wildly different places in the markup.
 */
function nearbyText(el: ObservedElement, all: ObservedElement[]): string {
  if (!el.bounds || el.text?.trim()) return '';
  const { x, y, width } = el.bounds;
  let best: { text: string; distance: number } | undefined;

  for (const other of all) {
    const text = other.text?.trim();
    if (!text || other.id === el.id || !other.bounds || text.length > 40) continue;
    // Above the field, or to its left, and horizontally overlapping it — the
    // two places a caption is ever put.
    const above = el.bounds.y - (other.bounds.y + other.bounds.height);
    const overlaps = other.bounds.x < x + width && other.bounds.x + other.bounds.width > x - 8;
    if (!overlaps || above < -4 || above > 60) continue;
    const distance = Math.abs(above) + Math.abs(other.bounds.x - x) / 8;
    if (!best || distance < best.distance) best = { text, distance };
  }
  return best ? ` gần-nhãn="${trim(best.text, 40)}"` : '';
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

interface Choice { index: number; confidence: number; reason: string }

/**
 * Reads the model's answer out of whatever it wrapped the JSON in.
 *
 * Tolerant of prose and code fences on purpose: a provider that throws on a
 * stray "Here you go:" turns a usable answer into a failed lookup.
 */
function parseChoice(raw: string): Choice | undefined {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Choice>;
    if (typeof parsed.index !== 'number') return undefined;
    return {
      index: parsed.index,
      confidence: Number(parsed.confidence) || 0,
      reason: String(parsed.reason ?? '').slice(0, 200),
    };
  } catch {
    return undefined;
  }
}

const clampConfidence = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
