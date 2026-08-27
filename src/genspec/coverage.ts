import type { ElementDef } from '../core/types.js';
import type { SourceDoc } from '../ingest/types.js';
import { completeJson, completeText } from '../llm/client.js';
import { FEATURE_SYSTEM, documentContext } from './prompt.js';

export type RequirementPriority = 'P0' | 'P1';

export interface CoverageRequirement {
  id: string;
  sourceId: string;
  priority: RequirementPriority;
  rule: string;
  sourceQuote: string;
  expectedResult: string;
  sourceRef: string;
}

export interface CoverageMap {
  requirements: CoverageRequirement[];
  classifiedSources: number;
  sourceUnits: number;
}

export interface CoverageMapping {
  requirementId: string;
  status: 'covered' | 'missing' | 'unclear';
  scenarios: string[];
  evidence: string[];
  reason: string;
}

export interface CoverageAudit {
  decision: 'ready' | 'repair';
  mappings: CoverageMapping[];
  missingRequirementIds: string[];
}

export interface CoverageGateResult {
  feature: string;
  map: CoverageMap;
  audit: CoverageAudit;
  repaired: boolean;
}

interface SourceUnit {
  id: string;
  sourceRef: string;
  quote: string;
  ruleLike: boolean;
}

interface CoverageDependencies {
  json?: typeof completeJson;
  text?: typeof completeText;
}

export interface CoverageOptions extends CoverageDependencies {
  model: string;
  maxTokens?: number;
  log?: (line: string) => void;
}

const CLASSIFY_SYSTEM = `Bạn là coverage analyst độc lập cho TestPilot.

Nhiệm vụ của bạn là phân loại MỌI source unit được cung cấp. Không được bỏ qua id.
- P0: mục tiêu/happy path chính.
- P1: quy tắc nghiệp vụ, validation, nhánh, biên, lỗi, phục hồi hoặc hành vi tự động
  có kết quả quan sát được.
- P2: chi tiết UI/ít rủi ro, chỉ sinh testcase khi nguồn ghi rõ là acceptance criterion.
- INFO: tiêu đề, giải thích nền, metadata hoặc câu không thể kiểm thử độc lập.

Một quy tắc như tự động lọc trùng, tự động sắp xếp, giới hạn dữ liệu, phân quyền hoặc
điều kiện "khi/nếu" là P1, không phải INFO. Không được gộp làm biến mất source id.
Chỉ dùng nội dung nguồn, không suy diễn selector hoặc hành vi mới.

Trả về đúng JSON:
{
  "classifications": [{
    "sourceId": "SRC-001",
    "priority": "P0|P1|P2|INFO",
    "rule": "quy tắc nghiệp vụ ngắn gọn",
    "expectedResult": "kết quả quan sát được hoặc chuỗi rỗng",
    "reason": "lý do phân loại ngắn"
  }]
}`;

const AUDIT_SYSTEM = `Bạn là coverage reviewer độc lập. Đối chiếu từng requirement
P0/P1 với file Gherkin. Chỉ đánh dấu covered khi có scenario thực sự tạo đúng điều
kiện/dữ liệu VÀ có assertion quan sát được chứng minh expected result.

Không được coi các trường hợp sau là covered:
- chỉ click/nhập/tìm kiếm mà không assert kết quả nghiệp vụ;
- một case gần giống nhưng kiểm tra quy tắc khác;
- requirement lọc trùng nhưng scenario chỉ kiểm tra có kết quả;
- tên scenario có nhắc tới requirement nhưng step không chứng minh nó;
- requirement nêu NHIỀU hành vi (hai chiều, hai loại, hai trạng thái) nhưng
  scenario chỉ chứng minh một trong số đó. Nếu requirement nói "A và B",
  "X sang Y và ngược lại", "cả ... lẫn ...", thì phải có scenario cho TỪNG vế;
  thiếu một vế là chưa covered.

Mỗi requirement id phải xuất hiện đúng một lần. evidence phải là các dòng ngắn có
thật trong feature; nếu không có evidence thì status phải là missing hoặc unclear.

Trả về đúng JSON:
{
  "mappings": [{
    "requirementId": "REQ-001",
    "status": "covered|missing|unclear",
    "scenarios": ["tên scenario"],
    "evidence": ["dòng Gherkin chứng minh"],
    "reason": "lý do ngắn"
  }]
}`;

/**
 * Extract a traceable requirement map before writing Gherkin.
 *
 * Source units are built deterministically first, so the model cannot silently
 * omit one paragraph or bullet. Any missing classification is promoted to P1
 * when its wording looks rule-like; over-coverage is reviewable, omission is not.
 */
export async function extractCoverageMap(
  docs: SourceDoc[],
  opts: CoverageOptions,
): Promise<CoverageMap> {
  const units = sourceUnits(docs);
  if (units.length === 0) return { requirements: [], classifiedSources: 0, sourceUnits: 0 };
  const json = opts.json ?? completeJson;
  const raw = await json({
    model: opts.model,
    maxTokens: opts.maxTokens ?? 8_000,
    temperature: 0,
    system: `${documentContext(docs)}\n\n${CLASSIFY_SYSTEM}`,
    user:
      'Phân loại toàn bộ source units dưới đây. Giữ nguyên sourceId:\n\n' +
      units.map((unit) => `${unit.id} | ${unit.quote}`).join('\n'),
  });
  const parsed = parseJsonObject(raw) as {
    classifications?: Array<{
      sourceId?: string;
      priority?: string;
      rule?: string;
      expectedResult?: string;
      reason?: string;
    }>;
  };
  const classified = new Map(
    (parsed.classifications ?? [])
      .filter((item) => item.sourceId)
      .map((item) => [item.sourceId!, item]),
  );

  const requirements: CoverageRequirement[] = [];
  let classifiedSources = 0;
  for (const unit of units) {
    const item = classified.get(unit.id);
    if (item) classifiedSources += 1;
    let priority = item?.priority?.toUpperCase();
    // Every rule-like source statement remains visible to the gate. This is
    // the deterministic safety net for an LLM that skips or downplays a note.
    if (!item && unit.ruleLike) priority = 'P1';
    if (priority === 'INFO' && unit.ruleLike) priority = 'P1';
    if (priority !== 'P0' && priority !== 'P1') continue;

    requirements.push({
      id: `REQ-${String(requirements.length + 1).padStart(3, '0')}`,
      sourceId: unit.id,
      priority,
      rule: clean(item?.rule) || unit.quote,
      sourceQuote: unit.quote,
      expectedResult: clean(item?.expectedResult) || inferExpectedResult(unit.quote),
      sourceRef: unit.sourceRef,
    });
  }

  return { requirements, classifiedSources, sourceUnits: units.length };
}

export async function auditFeatureCoverage(
  feature: string,
  requirements: CoverageRequirement[],
  opts: CoverageOptions,
): Promise<CoverageAudit> {
  if (requirements.length === 0) {
    return { decision: 'ready', mappings: [], missingRequirementIds: [] };
  }
  const json = opts.json ?? completeJson;
  const raw = await json({
    model: opts.model,
    maxTokens: opts.maxTokens ?? 8_000,
    temperature: 0,
    system: AUDIT_SYSTEM,
    user:
      `<requirements>\n${requirements.map(requirementLine).join('\n')}\n</requirements>\n\n` +
      `<feature>\n${feature}\n</feature>`,
  });
  const parsed = parseJsonObject(raw) as { mappings?: Array<Partial<CoverageMapping>> };
  const byId = new Map(
    (parsed.mappings ?? [])
      .filter((mapping) => mapping.requirementId)
      .map((mapping) => [mapping.requirementId!, mapping]),
  );
  const mappings = requirements.map((requirement): CoverageMapping => {
    const mapping = byId.get(requirement.id);
    const evidence = stringArray(mapping?.evidence).filter((line) =>
      normalized(feature).includes(normalized(line)),
    );
    const claimed = mapping?.status;
    const status: CoverageMapping['status'] =
      claimed === 'covered' && evidence.length > 0
        ? 'covered'
        : claimed === 'unclear'
          ? 'unclear'
          : 'missing';
    return {
      requirementId: requirement.id,
      status,
      scenarios: stringArray(mapping?.scenarios),
      evidence,
      reason: clean(mapping?.reason) || (mapping ? 'Không có evidence hợp lệ.' : 'Model không trả mapping.'),
    };
  });
  const missingRequirementIds = mappings
    .filter((mapping) => mapping.status !== 'covered')
    .map((mapping) => mapping.requirementId);
  return {
    decision: missingRequirementIds.length === 0 ? 'ready' : 'repair',
    mappings,
    missingRequirementIds,
  };
}

/**
 * Audit and repair once before handing the draft to human review.
 *
 * Coverage is a business-review concern, not a generation crash. If the model
 * cannot close every P0/P1 gap in one repair pass, keep the best draft and its
 * audit so the review UI can show exactly what remains. The durable workflow
 * re-audits the edited feature before automation is allowed to start.
 */
export async function enforceFeatureCoverage(
  docs: SourceDoc[],
  feature: string,
  elements: ElementDef[],
  map: CoverageMap,
  opts: CoverageOptions,
): Promise<CoverageGateResult> {
  let audit = await auditFeatureCoverage(feature, map.requirements, opts);
  if (audit.decision === 'ready') return { feature, map, audit, repaired: false };

  const missing = map.requirements.filter((requirement) =>
    audit.missingRequirementIds.includes(requirement.id),
  );
  opts.log?.(
    `Còn ${missing.length} yêu cầu bắt buộc chưa có testcase; ` +
    'AI đang bổ sung testcase trước khi đưa sang duyệt.',
  );
  const text = opts.text ?? completeText;
  const repairedFeature = stripFences(await text({
    model: opts.model,
    maxTokens: opts.maxTokens ?? 12_000,
    temperature: 0,
    system: `${documentContext(docs)}\n\n${FEATURE_SYSTEM}`,
    user:
      `Sửa file feature hiện tại để bổ sung TẤT CẢ requirement còn thiếu.\n` +
      `Giữ nguyên các scenario đúng, không xoá coverage đã có, không thêm selector.\n` +
      `Mỗi requirement mới phải có assertion quan sát được chứng minh kết quả.\n\n` +
      `<missing_requirements>\n${missing.map(requirementLine).join('\n')}\n</missing_requirements>\n\n` +
      `<known_elements>\n${elements.map((e) => `- ${e.id} — "${e.label}"`).join('\n')}\n</known_elements>\n\n` +
      `<current_feature>\n${feature}\n</current_feature>\n\n` +
      'Chỉ trả về toàn bộ file .feature đã sửa, bắt đầu bằng Feature:.'
  }));
  const repairedAudit = await auditFeatureCoverage(repairedFeature, map.requirements, opts);
  const initialCovered = coveredCount(audit);
  const repairedCovered = coveredCount(repairedAudit);
  const useRepair = repairedCovered >= initialCovered;
  const bestFeature = useRepair ? repairedFeature : feature;
  audit = useRepair ? repairedAudit : audit;

  if (audit.decision !== 'ready') {
    const unresolved = map.requirements
      .filter((requirement) => audit.missingRequirementIds.includes(requirement.id));
    opts.log?.(
      `Coverage còn thiếu ${unresolved.length} quy tắc P0/P1 sau vòng tự bổ sung. ` +
      'Bản nháp vẫn được chuyển sang màn Duyệt để người dùng xem và chỉnh sửa.',
    );
  }
  return { feature: bestFeature, map, audit, repaired: true };
}

function coveredCount(audit: CoverageAudit): number {
  return audit.mappings.filter((mapping) => mapping.status === 'covered').length;
}

export function coveragePromptBlock(requirements: CoverageRequirement[]): string {
  if (requirements.length === 0) return '';
  return `\n\nCOVERAGE CONTRACT BẮT BUỘC\n` +
    `Mỗi requirement P0/P1 dưới đây phải được ít nhất một scenario chứng minh bằng assertion; ` +
    `không được bỏ case để giới hạn số scenario:\n${requirements.map(requirementLine).join('\n')}`;
}

function sourceUnits(docs: SourceDoc[]): SourceUnit[] {
  const units: SourceUnit[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const fragments = doc.text
      .replace(/\r/g, '')
      .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\d@•*-])/u)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
      .filter((line) => line.length >= 8);
    for (const quote of fragments.flatMap(expandBidirectional)) {
      const key = normalized(quote);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      units.push({
        id: `SRC-${String(units.length + 1).padStart(3, '0')}`,
        sourceRef: doc.ref,
        quote,
        ruleLike: isRuleLike(quote),
      });
    }
  }
  return units;
}

/**
 * Split a rule that states two directions into one rule per direction.
 *
 * "Chuyển tiền từ tiểu khoản Thường sang Ký Quỹ và ngược lại" is a single
 * sentence naming two behaviours. Left whole, it was matched by a scenario
 * testing only the first, the audit recorded it as covered — its stated reason
 * never mentioned direction at all — and the gate reported `PASS 1/1` for a
 * requirement that was half tested. The reverse transfer was never written and
 * nothing anywhere said so.
 *
 * Only `ngược lại` is treated this way. It is an unambiguous marker of a second
 * required behaviour, unlike a bare "và", which joins clauses far more often
 * than it adds a requirement — splitting on that would bury the real gaps under
 * fragments nobody asked for.
 */
export function expandBidirectional(quote: string): string[] {
  if (!/\bngược lại\b/iu.test(quote)) return [quote];
  const forward = quote
    .replace(/\s*(?:,|;)?\s*và\s+ngược lại\b/iu, '')
    .replace(/\s*(?:,|;)?\s*ngược lại\b/iu, '')
    // "Thường → Ký Quỹ (và ngược lại)" leaves an empty bracket behind, which
    // then travels into the requirement a person has to read.
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[.,;:]$/, '');
  if (!forward) return [quote];

  // "từ X sang Y" is the shape these rules take; reversing it states the second
  // direction in the document's own words, which is what the audit compares
  // scenarios against.
  // The arrow is how these documents usually write a direction; without it the
  // reverse could only be named, not stated.
  const pair = forward.match(/^(.*?)\btừ\s+(.+?)\s*(sang|đến|tới|qua|→|->|=>)\s*(.+)$/iu);
  const reverse = pair
    ? `${pair[1]}từ ${pair[4]!.trim()} ${pair[3]} ${pair[2]!.trim()}`.replace(/\s{2,}/g, ' ').trim()
    // Unparsed but still stated: name it explicitly so a missing reverse
    // scenario is reported rather than quietly folded into the forward one.
    : `Chiều ngược lại của: ${forward}`;
  return [forward, reverse];
}

function isRuleLike(value: string): boolean {
  return /\b(khi|nếu|phải|tự động|không|chỉ|cho phép|hiển thị|lọc|kiểm tra|xác nhận|sau khi|trước khi|trường hợp)\b/iu.test(value);
}

function inferExpectedResult(quote: string): string {
  return quote.includes(':') ? quote.slice(quote.indexOf(':') + 1).trim() : quote;
}

function requirementLine(requirement: CoverageRequirement): string {
  return `${requirement.id} [${requirement.priority}] ` +
    `rule=${JSON.stringify(requirement.rule)}; expected=${JSON.stringify(requirement.expectedResult)}; ` +
    `source=${JSON.stringify(requirement.sourceQuote)}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Coverage model không trả JSON object hợp lệ.');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function stripFences(value: string): string {
  return value.trim().replace(/^```(?:gherkin)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function normalized(value: unknown): string {
  return clean(value).normalize('NFC').toLocaleLowerCase('vi-VN');
}
