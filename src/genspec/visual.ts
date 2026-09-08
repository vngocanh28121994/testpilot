import Anthropic from '@anthropic-ai/sdk';
import { firstJsonObject } from '../llm/json.js';
import { DEFAULT_LLM_MODEL } from '../config.js';
import type { SourceDoc, SourceVisual } from '../ingest/types.js';
import { confluenceFetch } from '../ingest/confluenceMedia.js';
import { hasKey, providerOf } from '../llm/client.js';

const MAX_VISUALS = 48;
const VISUALS_PER_CALL = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const GEMINI_TIMEOUT_MS = 90_000;
const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.6-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

interface LoadedVisual {
  id: string;
  docIndex: number;
  ref: string;
  title?: string;
  mediaType: SupportedMediaType;
  data: string;
}

interface VisualFinding {
  id: string;
  screen: string;
  visibleText: string[];
  components: string[];
  interactions: string[];
  states: string[];
  businessEvidence: string[];
  uncertainties: string[];
}

interface VisionClient {
  messages: {
    create(params: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface VisualEnrichmentResult {
  docs: SourceDoc[];
  discovered: number;
  analyzed: number;
  skipped: number;
}

export interface VisualEnrichmentOptions {
  model?: string;
  client?: VisionClient;
  log?: (line: string) => void;
  fetcher?: typeof fetch;
  /** Separate injection point so tests never call the real Gemini endpoint. */
  geminiFetcher?: typeof fetch;
}

/**
 * Converts private Confluence attachments and Figma renders into conservative,
 * traceable text evidence once. The normal model/feature passes can then remain
 * provider-independent and cacheable, including when DeepSeek writes Gherkin.
 */
export async function enrichDocsWithVisualEvidence(
  docs: SourceDoc[],
  opts: VisualEnrichmentOptions = {},
): Promise<VisualEnrichmentResult> {
  const all = docs.flatMap((doc, docIndex) =>
    (doc.visuals ?? []).map((visual, visualIndex) => ({
      visual,
      docIndex,
      id: `doc-${docIndex + 1}-image-${visualIndex + 1}`,
    })),
  );
  if (all.length === 0) return { docs, discovered: 0, analyzed: 0, skipped: 0 };

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!opts.client && !geminiKey && !hasKey('anthropic')) {
    throw new Error(
      `Tài liệu có ${all.length} ảnh/design nhưng model hiện tại không đọc được hình ảnh. ` +
        'Hãy thêm GEMINI_API_KEY (khuyến nghị) hoặc ANTHROPIC_API_KEY để Horus phân tích ảnh ' +
        'trước khi giao phần text còn lại cho DeepSeek.',
    );
  }

  if (all.length > MAX_VISUALS) {
    throw new Error(
      `Tài liệu có ${all.length} ảnh, vượt giới hạn an toàn ${MAX_VISUALS} ảnh/workflow. ` +
        'Hãy dùng link tới đúng page/node Figma cần kiểm thử để tránh trộn nhiều chức năng.',
    );
  }
  const selected = all;
  // Confluence attachment URLs are private; a bare fetch gets 401. The wrapper
  // presents the credential to the sites these documents came from and to no
  // other host, so an image hotlinked from elsewhere cannot collect the token.
  const fetcher = opts.fetcher ?? confluenceFetch(
    docs.filter((doc) => doc.kind === 'confluence')
      .map((doc) => { try { return new URL(doc.ref).origin; } catch { return ''; } }),
  );
  const loaded: LoadedVisual[] = [];
  const loadErrors: string[] = [];
  for (const item of selected) {
    try {
      loaded.push(await loadVisual(item.visual, item.id, item.docIndex, fetcher));
    } catch (err) {
      loadErrors.push(`${item.id}: ${(err as Error).message}`);
    }
  }
  if (loadErrors.length > 0) {
    throw new Error(
      `Không tải được ${loadErrors.length}/${all.length} ảnh/design: ${loadErrors.slice(0, 3).join('; ')}. ` +
        'Workflow đã dừng để không sinh testcase thiếu bằng chứng. MCP cần trả image content ' +
        'dạng base64 hoặc URL ảnh còn hiệu lực.',
    );
  }

  const useGemini = !opts.client && Boolean(geminiKey);
  const configured = opts.model?.trim() || '';
  const visionModel = useGemini
    ? process.env.GEMINI_VISION_MODEL?.trim() || DEFAULT_GEMINI_VISION_MODEL
    : configured && providerOf(configured) === 'anthropic'
      ? configured
      : DEFAULT_LLM_MODEL;
  opts.log?.(
    `AI vision: phân tích đủ ${loaded.length} ảnh bằng ` +
      `${useGemini ? 'Gemini' : 'Anthropic'} (${visionModel}) ` +
      `(${Math.ceil(loaded.length / VISUALS_PER_CALL)} batch).`,
  );

  const client = useGemini
    ? undefined
    : opts.client ?? (new Anthropic() as unknown as VisionClient);
  const findings: VisualFinding[] = [];
  for (let offset = 0; offset < loaded.length; offset += VISUALS_PER_CALL) {
    const batch = loaded.slice(offset, offset + VISUALS_PER_CALL);
    findings.push(...await (useGemini
      ? analyzeGeminiBatch(
          geminiKey!,
          visionModel,
          batch,
          docs,
          opts.geminiFetcher ?? fetch,
        )
      : analyzeAnthropicBatch(client!, visionModel, batch, docs)));
  }
  const returned = new Set(findings.map((item) => item.id));
  const missing = loaded.filter((item) => !returned.has(item.id));
  if (missing.length > 0) {
    throw new Error(
      `AI vision không trả bằng chứng cho ${missing.length}/${loaded.length} ảnh ` +
        `(${missing.slice(0, 3).map((item) => item.id).join(', ')}). Workflow đã dừng.`,
    );
  }
  const byDoc = new Map<number, VisualFinding[]>();
  for (const finding of findings) {
    const visual = loaded.find((item) => item.id === finding.id);
    if (!visual) continue;
    const list = byDoc.get(visual.docIndex) ?? [];
    list.push(finding);
    byDoc.set(visual.docIndex, list);
  }
  if (byDoc.size === 0) {
    throw new Error('AI vision không trả về bằng chứng khớp với các ảnh đã gửi.');
  }

  return {
    docs: docs.map((doc, index) => {
      const docFindings = byDoc.get(index);
      return docFindings?.length
        ? { ...doc, visualEvidence: formatEvidence(docFindings) }
        : doc;
    }),
    discovered: all.length,
    analyzed: loaded.length,
    skipped: 0,
  };
}

async function analyzeAnthropicBatch(
  client: VisionClient,
  visionModel: string,
  batch: LoadedVisual[],
  docs: SourceDoc[],
): Promise<VisualFinding[]> {
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: visualPrompt(batch, docs) },
  ];
  for (const visual of batch) {
    content.push({ type: 'text', text: `Ảnh ${visual.id}${visual.title ? ` — ${visual.title}` : ''}` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: visual.mediaType, data: visual.data },
    });
  }
  const response = await client.messages.create({
    model: visionModel,
    max_tokens: 12_000,
    temperature: 0,
    system:
      'Bạn phân tích bằng chứng giao diện để thiết kế testcase. Chỉ ghi điều nhìn thấy; ' +
      'không suy diễn hành vi ẩn, API, validation hoặc expected result không thể quan sát.',
    messages: [{ role: 'user', content }],
  });
  const raw = response.content.find((part) => part.type === 'text')?.text ?? '';
  return parseFindings(raw);
}

async function analyzeGeminiBatch(
  key: string,
  visionModel: string,
  batch: LoadedVisual[],
  docs: SourceDoc[],
  fetcher: typeof fetch,
): Promise<VisualFinding[]> {
  const parts: Array<Record<string, unknown>> = [
    { text: visualPrompt(batch, docs) },
  ];
  for (const visual of batch) {
    parts.push({ text: `Ảnh ${visual.id}${visual.title ? ` — ${visual.title}` : ''}` });
    parts.push({
      inlineData: { mimeType: visual.mediaType, data: visual.data },
    });
  }
  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(visionModel)}:generateContent`;
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text:
            'Bạn phân tích bằng chứng giao diện để thiết kế testcase. Chỉ ghi điều nhìn thấy; ' +
            'không suy diễn hành vi ẩn, API, validation hoặc expected result không thể quan sát.',
        }],
      },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 12_000,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Gemini Vision ${response.status}: ${detail || response.statusText}`);
  }
  const body = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = body.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('\n') ?? '';
  return parseFindings(raw);
}

async function loadVisual(
  visual: SourceVisual,
  id: string,
  docIndex: number,
  fetcher: typeof fetch,
): Promise<LoadedVisual> {
  if (visual.data) {
    const data = stripDataPrefix(visual.data);
    const bytes = Buffer.from(data, 'base64');
    ensureSize(bytes.length);
    return {
      id,
      docIndex,
      ref: safeRef(visual.ref),
      ...(visual.title ? { title: visual.title } : {}),
      mediaType: supportedMediaType(visual.mimeType, bytes),
      data,
    };
  }

  const dataUri = /^data:([^;,]+);base64,(.+)$/is.exec(visual.ref);
  if (dataUri) {
    return loadVisual(
      { ...visual, ref: id, mimeType: dataUri[1], data: dataUri[2] },
      id,
      docIndex,
      fetcher,
    );
  }
  if (!/^https?:\/\//i.test(visual.ref)) throw new Error('ảnh không có URL/base64 hợp lệ');

  const response = await fetcher(visual.ref, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`không tải được ảnh (HTTP ${response.status})`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength) ensureSize(contentLength);
  const bytes = Buffer.from(await response.arrayBuffer());
  ensureSize(bytes.length);
  return {
    id,
    docIndex,
    ref: safeRef(visual.ref),
    ...(visual.title ? { title: visual.title } : {}),
    mediaType: supportedMediaType(response.headers.get('content-type') ?? visual.mimeType, bytes),
    data: bytes.toString('base64'),
  };
}

function visualPrompt(loaded: LoadedVisual[], docs: SourceDoc[]): string {
  const index = loaded
    .map((item) => `- ${item.id}: tài liệu "${docs[item.docIndex]?.title ?? 'không tên'}"`)
    .join('\n');
  return `Phân tích các ảnh giao diện bên dưới như bằng chứng bổ sung cho tài liệu.

${index}

Với từng ảnh:
- Ghi mục đích/màn hình nếu nhìn thấy rõ.
- Ghi chính xác text, label, tab, field, button, bảng, popup và trạng thái hiển thị.
- Mô tả tương tác có thể quan sát trực tiếp từ control, không bịa luồng sau click.
- Chỉ ghi quy tắc nghiệp vụ nếu ảnh thể hiện trực tiếp bằng text/trạng thái.
- Phần không rõ phải đưa vào uncertainties.

Chỉ trả JSON đúng cấu trúc:
{
  "assets": [{
    "id": "doc-1-image-1",
    "screen": "",
    "visibleText": [],
    "components": [],
    "interactions": [],
    "states": [],
    "businessEvidence": [],
    "uncertainties": []
  }]
}`;
}

function parseFindings(raw: string): VisualFinding[] {
  const parsed = JSON.parse(firstJsonObject(raw)) as { assets?: Array<Record<string, unknown>> };
  return (parsed.assets ?? [])
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: item.id as string,
      screen: stringOf(item.screen),
      visibleText: stringsOf(item.visibleText),
      components: stringsOf(item.components),
      interactions: stringsOf(item.interactions),
      states: stringsOf(item.states),
      businessEvidence: stringsOf(item.businessEvidence),
      uncertainties: stringsOf(item.uncertainties),
    }));
}

function formatEvidence(findings: VisualFinding[]): string {
  return findings.map((finding) => {
    const lines = [`[${finding.id}]${finding.screen ? ` Màn hình: ${finding.screen}` : ''}`];
    addSection(lines, 'Text nhìn thấy', finding.visibleText);
    addSection(lines, 'Thành phần', finding.components);
    addSection(lines, 'Tương tác quan sát được', finding.interactions);
    addSection(lines, 'Trạng thái', finding.states);
    addSection(lines, 'Bằng chứng nghiệp vụ', finding.businessEvidence);
    addSection(lines, 'Chưa rõ', finding.uncertainties);
    return lines.join('\n');
  }).join('\n\n');
}

function addSection(lines: string[], title: string, values: string[]): void {
  if (values.length > 0) lines.push(`${title}: ${values.join(' | ')}`);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripDataPrefix(value: string): string {
  return value.replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
}

function ensureSize(bytes: number): void {
  if (bytes === 0) throw new Error('ảnh rỗng');
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`ảnh lớn hơn ${MAX_IMAGE_BYTES / 1024 / 1024}MB`);
}

function supportedMediaType(value: string | undefined, bytes: Buffer): SupportedMediaType {
  const normalized = value?.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/jpeg' || normalized === 'image/png' ||
      normalized === 'image/gif' || normalized === 'image/webp') return normalized;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  throw new Error(`định dạng ảnh không được hỗ trợ (${normalized ?? 'không xác định'})`);
}

function safeRef(ref: string): string {
  try {
    const url = new URL(ref);
    url.search = '';
    return url.toString();
  } catch {
    return ref.startsWith('mcp-image-') || ref.startsWith('inline-') ? ref : 'private-image';
  }
}
