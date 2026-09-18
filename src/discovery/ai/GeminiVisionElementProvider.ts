import { firstJsonObject } from '../../llm/json.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement, UiObservation } from '../UiObservation.js';
import type {
  AiElementCandidate,
  VisionDiscoveryResponse,
  VisionLlmProvider,
} from './AiDiscoveryTypes.js';
import { iconMeaningMatches } from '../ConfidenceScorer.js';
import {
  DEFAULT_VISION_MODEL_CHAIN,
  ExhaustedModels,
  shouldTryNextModel,
  visionModelChain,
} from './geminiModels.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = DEFAULT_VISION_MODEL_CHAIN[0];
const RUNTIME_TIMEOUT_MS = 12_000;
const MAX_OBSERVED_ELEMENTS = 160;
const PRIMARY_OUTPUT_TOKENS = 1_800;
const RETRY_OUTPUT_TOKENS = 3_000;

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          observedElementId: { type: 'string' },
          clickableAncestorObservedElementId: { type: 'string' },
          visualText: { type: 'string' },
          visualDescription: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          reasoning: { type: 'string' },
          bounds: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false,
          },
        },
        required: ['observedElementId', 'visualDescription', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
    description: { type: 'string' },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

/**
 * Gemini adapter for the last-resort runtime vision tier.
 *
 * This deliberately uses the same GEMINI_API_KEY / GOOGLE_API_KEY and model
 * override as genspec/visual.ts. DeepSeek can keep doing the cheaper semantic
 * ranking; a screenshot is sent only when both deterministic and semantic
 * discovery have no usable candidate.
 */
export class GeminiVisionElementProvider implements VisionLlmProvider {
  /**
   * Model nào đã cạn quota, nhớ suốt đời provider.
   *
   * Không nhớ thì mỗi element cần thị giác lại gọi model đã chết một lần trước
   * khi sang model sống — hàng chục round-trip chỉ để nhận lại đúng lỗi 429 đã
   * biết từ element đầu tiên.
   */
  private readonly exhausted = new ExhaustedModels();

  private readonly chain: readonly string[];

  constructor(
    private readonly key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    // Nhận cả một model lẻ: phần lớn nơi gọi chỉ muốn ghim đúng một model, và
    // bắt chúng bọc thành mảng chỉ để dùng được chuỗi fallback là bắt trả giá
    // cho một tính năng chúng không dùng.
    models: string | readonly string[] = visionModelChain(),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.chain = typeof models === 'string' ? visionModelChain(models) : models;
  }

  /** Model sẽ được gọi trước tiên ở lần tới — thứ báo cáo và log cần biết. */
  get model(): string {
    return this.exhausted.usable(this.chain)[0] ?? DEFAULT_MODEL;
  }

  static available(): boolean {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  }

  async findElementInScreenshot(
    intent: ElementIntent,
    screenshotBase64: string,
    observation?: UiObservation,
  ): Promise<VisionDiscoveryResponse> {
    if (!this.key) throw new Error('Chưa có GEMINI_API_KEY cho runtime vision.');
    if (!observation?.elements.length) {
      throw new Error('Runtime vision cần UI observation cùng thời điểm với screenshot.');
    }

    const chain = this.exhausted.usable(this.chain);
    const failures: string[] = [];
    for (const model of chain) {
      try {
        return await this.askOneModel(model, intent, screenshotBase64, observation, {
          hasFallback: model !== chain[chain.length - 1],
        });
      } catch (err) {
        const message = (err as Error).message;
        this.exhausted.remember(model, message);
        failures.push(`${model}: ${message.slice(0, 120)}`);
        // Chỉ chuyển model khi lỗi thuộc về CHÍNH model — hết quota, không có
        // model ấy, dịch vụ lỗi. Ảnh hỏng, thiếu key hay JSON không parse được
        // thì model sau cũng hỏng y hệt, và thử tiếp chỉ làm chậm lúc hỏng rồi
        // giấu mất nguyên nhân thật sau hai lỗi giống nhau.
        if (!shouldTryNextModel(message)) throw err;
        if (model !== chain[chain.length - 1]) {
          console.warn(`[discovery:vision] ${model} không gọi được — chuyển sang model dự phòng.`);
        }
      }
    }
    // Nói ra từng model đã thử và hỏng vì gì. Một dòng "Gemini Vision 429" mà
    // không biết nó nói về model nào thì không truy được, và đó đúng là thứ
    // chuỗi fallback này làm phức tạp thêm.
    throw new Error(`Gemini Vision hỏng ở mọi model — ${failures.join(' | ')}`);
  }

  private async askOneModel(
    model: string,
    intent: ElementIntent,
    screenshotBase64: string,
    observation: UiObservation,
    { hasFallback }: { hasFallback: boolean },
  ): Promise<VisionDiscoveryResponse> {
    const elements = shortlist(observation.elements, intent);
    const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
    let totalTokens = 0;
    let lastError: Error | undefined;
    for (const [attempt, maxOutputTokens] of [PRIMARY_OUTPUT_TOKENS, RETRY_OUTPUT_TOKENS].entries()) {
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.key,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [{
            role: 'user',
            parts: [
              { text: promptFor(intent, observation, elements) },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: stripDataPrefix(screenshotBase64),
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: RESPONSE_JSON_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        const error = new Error(`Gemini Vision ${response.status}: ${detail || response.statusText}`);
        // Capacity/rate-limit failures are explicitly transient. Keep auth,
        // model-name and malformed-request errors fail-fast so a bad config is
        // not hidden behind a duplicate request.
        //
        // Nhưng khi còn model dự phòng thì 429 không đáng thử lại tại chỗ: một
        // model vừa nói hết quota sẽ không đổi ý sau 250ms, và chuyển sang
        // model khác vừa nhanh hơn vừa có cơ may thành công. Không còn gì để
        // chuyển thì thử lại vẫn hơn là bỏ cuộc — đó là hành vi cũ, và nó chỉ
        // đúng trong đúng trường hợp ấy.
        const retryInPlace = response.status >= 500 || !hasFallback;
        if (attempt === 0 && retryInPlace && (response.status === 429 || response.status >= 500)) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        throw error;
      }

      const body = await response.json() as {
        candidates?: Array<{
          finishReason?: string;
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: { totalTokenCount?: number };
      };
      totalTokens += body.usageMetadata?.totalTokenCount ?? 0;
      const raw = body.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('\n') ?? '';
      const finishReason = body.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS' && attempt === 0) {
        lastError = new Error('Gemini Vision hết ngân sách output trước khi đóng JSON.');
        continue;
      }
      try {
        const parsed = parseVisionAnswer(raw, elements);
        return {
          ...parsed,
          modelId: model,
          ...(totalTokens > 0 ? { tokensUsed: totalTokens } : {}),
        };
      } catch (err) {
        lastError = err as Error;
        // A malformed/truncated structured response is transient. Retry once
        // with a larger output budget; HTTP/auth/model errors are not retried.
        if (attempt === 0) continue;
      }
    }
    throw lastError ?? new Error('Gemini Vision không trả về JSON hợp lệ.');
  }
}

const SYSTEM_PROMPT = [
  'Bạn tìm phần tử UI trong screenshot để thực hiện một bước kiểm thử tự động.',
  'Danh sách node quan sát được đi kèm là nguồn ID và locator; screenshot là bằng chứng về bố cục/ý nghĩa.',
  'Chỉ chọn node thực sự tương ứng với yêu cầu. Không tự kết luận testcase đã pass.',
  'Nếu chữ hoặc icon nằm trong một control cha có thể bấm, trả node chữ/icon làm observedElementId và control cha làm clickableAncestorObservedElementId.',
  'Với mỗi phương án, visualText phải là chữ thực sự nhìn thấy trong đúng vùng đó; không diễn giải hay viết lại.',
  'Nếu control chỉ có icon, để visualText là ký hiệu nhìn thấy (nếu có) và dùng visualDescription để mô tả ý nghĩa/chức năng của chính control đó theo screenshot và ngữ cảnh.',
  'Trả tối đa 3 phương án xếp hạng. Nếu không đủ bằng chứng, trả {"candidates":[]}. Chỉ trả JSON.',
].join('\n');

function promptFor(
  intent: ElementIntent,
  observation: UiObservation,
  elements: ObservedElement[],
): string {
  const rows = elements.map((element) => JSON.stringify({
    id: element.id,
    parentId: element.parentId,
    role: element.role,
    text: element.text,
    label: element.accessibilityLabel,
    placeholder: element.placeholder,
    testId: element.testId,
    resourceId: element.resourceId,
    css: element.css,
    interactive: element.interactive,
    bounds: element.bounds,
  }));
  return [
    `Platform: ${observation.platform}`,
    `Action: ${intent.action}`,
    `Tên nghiệp vụ: ${intent.label ?? ''}`,
    `Text cần tìm: ${intent.text ?? ''}`,
    `Ngữ cảnh và hậu điều kiện: ${(intent.context ?? []).join(' | ')}`,
    '',
    'Các node quan sát được:',
    ...rows,
    '',
    'Trả JSON:',
    '{"candidates":[{"observedElementId":"<id>","clickableAncestorObservedElementId":"<id, nếu có>","visualText":"<chữ nhìn thấy nguyên văn>","visualDescription":"<ý nghĩa của icon/control>","confidence":0,"reasoning":"<lý do>","bounds":{"x":0,"y":0,"width":0,"height":0}}],"description":"<mô tả ngắn>"}',
  ].join('\n');
}

function shortlist(elements: ObservedElement[], intent: ElementIntent): ObservedElement[] {
  const useful = elements.filter((element) =>
    element.visible && Boolean(
      element.interactive || element.text || element.accessibilityLabel ||
      element.placeholder || element.testId || element.resourceId,
    ));
  // DOM order puts large amounts of static copy before row controls. Preserve
  // order within a tier, but ensure bounded, actionable and addressable nodes
  // survive the prompt cut — these are the only nodes Vision can safely act on.
  return useful
    .map((element, index) => ({ element, index }))
    .sort((a, b) => {
      const rank = (item: ObservedElement) =>
        // Keep icon controls relevant to the requested business verb ahead of
        // generic navigation and content nodes. On large Angular screens the
        // intended FAB can occur after hundreds of DOM nodes and used to be
        // cut from the Vision prompt before Gemini could even consider it.
        (item.text && iconMeaningMatches(item.text, intent.text ?? intent.label ?? '') ? 20 : 0) +
        (item.interactive ? 4 : 0) + (item.bounds ? 2 : 0) +
        (item.testId || item.resourceId || item.css ? 2 : 0) +
        (item.accessibilityLabel || item.placeholder ? 1 : 0);
      return rank(b.element) - rank(a.element) || a.index - b.index;
    })
    .slice(0, MAX_OBSERVED_ELEMENTS)
    .map(({ element }) => element);
}

export function parseVisionAnswer(
  raw: string,
  elements: ObservedElement[],
): Omit<VisionDiscoveryResponse, 'modelId' | 'tokensUsed'> {
  const value = JSON.parse(firstJsonObject(raw)) as {
    candidates?: Array<{
      observedElementId?: unknown;
      clickableAncestorObservedElementId?: unknown;
      visualText?: unknown;
      visualDescription?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
      bounds?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    }>;
    candidate?: {
      observedElementId?: unknown;
      clickableAncestorObservedElementId?: unknown;
      visualText?: unknown;
      visualDescription?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    } | null;
    bounds?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    description?: unknown;
  };
  const rawCandidates = [
    ...(Array.isArray(value.candidates) ? value.candidates : []),
    ...(value.candidate ? [{ ...value.candidate, bounds: value.bounds }] : []),
  ];
  if (rawCandidates.length === 0) {
    return typeof value.description === 'string' ? { description: value.description } : {};
  }
  const ids = new Set(elements.map((element) => element.id));
  const candidates = rawCandidates.flatMap((rawCandidate): AiElementCandidate[] => {
    if (typeof rawCandidate.observedElementId !== 'string') return [];
    const bounds = parseBounds(rawCandidate.bounds);
    // An invented id alone is unusable. Bounds are allowed as a fallback
    // because the next layer must correlate them to a real observed node.
    if (!ids.has(rawCandidate.observedElementId) && !bounds) return [];
    return [{
      observedElementId: rawCandidate.observedElementId,
      confidence: clampConfidence(rawCandidate.confidence),
      reasoning: typeof rawCandidate.reasoning === 'string'
        ? rawCandidate.reasoning.slice(0, 500)
        : 'Gemini đối chiếu screenshot với UI observation.',
      ...(typeof rawCandidate.clickableAncestorObservedElementId === 'string' &&
        ids.has(rawCandidate.clickableAncestorObservedElementId)
        ? { clickableAncestorObservedElementId: rawCandidate.clickableAncestorObservedElementId }
        : {}),
      ...(typeof rawCandidate.visualText === 'string' && rawCandidate.visualText.trim()
        ? { visualText: rawCandidate.visualText.trim().slice(0, 300) }
        : {}),
      ...(typeof rawCandidate.visualDescription === 'string' && rawCandidate.visualDescription.trim()
        ? { visualDescription: rawCandidate.visualDescription.trim().slice(0, 300) }
        : {}),
      ...(bounds ? { visualBounds: bounds } : {}),
    }];
  }).filter((candidate, index, all) =>
    all.findIndex((other) =>
      other.observedElementId === candidate.observedElementId &&
      other.clickableAncestorObservedElementId === candidate.clickableAncestorObservedElementId,
    ) === index).slice(0, 3);
  if (candidates.length === 0) return {};
  return {
    candidates,
    candidate: candidates[0],
    ...(candidates[0]?.visualBounds ? { bounds: candidates[0].visualBounds } : {}),
    ...(typeof value.description === 'string' ? { description: value.description.slice(0, 500) } : {}),
  };
}

function parseBounds(value: {
  x?: unknown; y?: unknown; width?: unknown; height?: unknown;
} | undefined): VisionDiscoveryResponse['bounds'] | undefined {
  if (!value) return undefined;
  const { x, y, width, height } = value;
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) ||
    typeof height !== 'number' || !Number.isFinite(height)
  ) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

function stripDataPrefix(value: string): string {
  return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
}
