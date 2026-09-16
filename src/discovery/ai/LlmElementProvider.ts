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
import { firstJsonObject } from '../../llm/json.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement, UiObservation } from '../UiObservation.js';
import type { LlmProvider, SemanticDiscoveryResponse } from './AiDiscoveryTypes.js';
import { normalizeHumanText } from '../../core/text.js';

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

    const parsed = parseChoices(raw)
      .filter((choice) => choice.index >= 0 && choice.index < shortlist.length)
      .slice(0, 3);
    if (parsed.length === 0) {
      this.log(`[semantic-ai] không chọn được: ${raw.slice(0, 120)}`);
      return { modelId: this.model };
    }

    const candidates = parsed.map((choice) => {
      const picked = shortlist[choice.index]!;
      const ancestor = choice.clickableAncestorIndex != null
        ? shortlist[choice.clickableAncestorIndex]
        : undefined;
      return {
        observedElementId: picked.id,
        confidence: clampConfidence(choice.confidence),
        reasoning: choice.reason,
        ...(ancestor && ancestor.id !== picked.id
          ? { clickableAncestorObservedElementId: ancestor.id }
          : {}),
      };
    });
    return {
      candidates,
      candidate: candidates[0],
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
  '- Trả tối đa 3 phương án xếp theo độ phù hợp. Nếu chữ/icon là node con, chỉ ra clickableAncestorIndex.',
  '- Không tự kết luận action thành công; bước sau của kịch bản là bằng chứng bắt buộc.',
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
  const intentWords = meaningfulWords([
    intent.label,
    intent.text,
    ...(intent.context ?? []),
  ].filter(Boolean).join(' '));
  const rank = (e: ObservedElement): number => {
    let score = 0;
    if (e.interactive) score += 2;
    if (wantsInput && /input|textbox|combobox|searchbox|textarea|select/i.test(e.role ?? '')) score += 3;
    if (e.testId || e.resourceId) score += 1;
    if (e.accessibilityLabel || e.placeholder) score += 1;
    const elementWords = meaningfulWords([
      e.text, e.accessibilityLabel, e.placeholder, e.attributes?.region,
    ].filter(Boolean).join(' '));
    score += Math.min(4, [...elementWords].filter((word) => intentWords.has(word)).length * 2);
    return score;
  };
  const ranked = [...usable].sort((a, b) => rank(b) - rank(a));
  const selected = ranked.slice(0, MAX_ELEMENTS);
  const selectedIds = new Set(selected.map((element) => element.id));
  const byId = new Map(all.map((element) => [element.id, element]));

  // If a semantic text/icon leaf made the cut, its actionable ancestors must
  // be in the same prompt or the model can identify the caption but has no way
  // to nominate the control that owns the click.
  for (const leaf of [...selected]) {
    let parent = leaf.parentId ? byId.get(leaf.parentId) : undefined;
    while (parent) {
      if (parent.visible && describes(parent) && !selectedIds.has(parent.id)) {
        if (selected.length >= MAX_ELEMENTS) {
          const removed = selected.pop();
          if (removed) selectedIds.delete(removed.id);
        }
        selected.push(parent);
        selectedIds.add(parent.id);
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
  }
  return selected;
}

function meaningfulWords(value: string): Set<string> {
  return new Set(normalizeHumanText(value)
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !SEMANTIC_STOP_WORDS.has(word)));
}

const SEMANTIC_STOP_WORDS = new Set([
  'buoc', 'hien', 'tai', 'ket', 'qua', 'can', 'chung', 'minh',
  'the', 'this', 'that', 'current', 'expected', 'visible',
]);

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
  const indexById = new Map(elements.map((element, index) => [element.id, index]));
  const listing = elements
    .map((e, i) => `#${i} ${describe(e, indexById)}${nearbyText(e, all)}`)
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
    'Trả JSON: {"candidates":[{"index":<số #>,"clickableAncestorIndex":<số # hoặc bỏ qua>,"confidence":<0-100>,"reason":"<một câu>"}]}',
    'Xếp tốt nhất trước, tối đa 3. Không có phần tử đúng thì trả {"candidates":[]}.',
  ].filter(Boolean).join('\n');
}

function describe(e: ObservedElement, indexById: Map<string, number>): string {
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
    e.parentId && indexById.has(e.parentId) ? `parent=#${indexById.get(e.parentId)}` : '',
    e.childIds?.length
      ? `children=${e.childIds.flatMap((id) => indexById.has(id) ? [`#${indexById.get(id)}`] : []).join(',')}`
      : '',
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

interface Choice {
  index: number;
  confidence: number;
  reason: string;
  clickableAncestorIndex?: number;
}

/**
 * Reads the model's answer out of whatever it wrapped the JSON in.
 *
 * Tolerant of prose and code fences on purpose: a provider that throws on a
 * stray "Here you go:" turns a usable answer into a failed lookup.
 */
export function parseChoices(raw: string): Choice[] {
  // Cùng bộ tách với genspec. Chỗ này hỏng còn lặng lẽ hơn: nó trả undefined,
  // nên "model trả hai JSON" trông y hệt "model không tìm được element nào".
  let text: string;
  try {
    text = firstJsonObject(raw);
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as Partial<Choice> & { candidates?: Partial<Choice>[] };
    const rawChoices = Array.isArray(parsed.candidates) ? parsed.candidates : [parsed];
    const seen = new Set<number>();
    return rawChoices.flatMap((choice) => {
      if (typeof choice.index !== 'number' || choice.index < 0 || seen.has(choice.index)) return [];
      seen.add(choice.index);
      return [{
        index: choice.index,
        confidence: Number(choice.confidence) || 0,
        reason: String(choice.reason ?? '').slice(0, 200),
        ...(typeof choice.clickableAncestorIndex === 'number'
          ? { clickableAncestorIndex: choice.clickableAncestorIndex }
          : {}),
      }];
    });
  } catch {
    return [];
  }
}

const clampConfidence = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
