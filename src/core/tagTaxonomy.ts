/**
 * One tag language for generation, review, local runs and Device Farm.
 *
 * Tags are execution metadata, not prose. Letting each model or author invent
 * another spelling makes filters meaningless, so every entry passes through
 * this module before it reaches the runtime.
 */

export type TagCategory = 'priority' | 'suite' | 'type' | 'platform' | 'operation' | 'feature';

export interface TagDefinition {
  name: string;
  category: Exclude<TagCategory, 'feature'>;
  label: string;
  description: string;
}

export interface TagTaxonomyView {
  version: number;
  definitions: TagDefinition[];
  featurePattern: string;
  aliases: Record<string, string>;
}

export const TAG_DEFINITIONS: readonly TagDefinition[] = [
  { name: '@p0', category: 'priority', label: 'P0 · Luồng trọng yếu', description: 'Happy path hoặc mục tiêu nghiệp vụ quan trọng nhất.' },
  { name: '@p1', category: 'priority', label: 'P1 · Quy tắc quan trọng', description: 'Validation, nhánh, biên, lỗi hoặc quy tắc nghiệp vụ có ý nghĩa.' },
  { name: '@p2', category: 'priority', label: 'P2 · Bổ sung', description: 'Regression ít rủi ro hoặc tiêu chí giao diện được yêu cầu rõ.' },
  { name: '@smoke', category: 'suite', label: 'Smoke', description: 'Tập kiểm tra nhanh cho mục tiêu chính.' },
  { name: '@regression', category: 'suite', label: 'Regression', description: 'Tập regression được quản lý chủ động.' },
  { name: '@positive', category: 'type', label: 'Luồng thành công', description: 'Hành vi hợp lệ và kết quả thành công.' },
  { name: '@negative', category: 'type', label: 'Luồng lỗi', description: 'Dữ liệu hoặc trạng thái không hợp lệ có expected result rõ.' },
  { name: '@boundary', category: 'type', label: 'Giá trị biên', description: 'Giới hạn, ngưỡng, tối đa hoặc tối thiểu được tài liệu định nghĩa.' },
  { name: '@business-rule', category: 'type', label: 'Quy tắc nghiệp vụ', description: 'Hành vi tự động, lọc trùng, phân quyền hoặc điều kiện nghiệp vụ.' },
  { name: '@web', category: 'platform', label: 'Web', description: 'Chỉ dùng khi hành vi nghiệp vụ riêng cho Web.' },
  { name: '@android', category: 'platform', label: 'Android', description: 'Chỉ dùng khi hành vi nghiệp vụ riêng cho Android.' },
  { name: '@ios', category: 'platform', label: 'iOS', description: 'Chỉ dùng khi hành vi nghiệp vụ riêng cho iOS.' },
  { name: '@diagnostic', category: 'operation', label: 'Chẩn đoán', description: 'Kịch bản kỹ thuật dùng để chẩn đoán hạ tầng.' },
] as const;

/** Old and common AI spellings remain runnable, but never appear as new tags. */
export const TAG_ALIASES: Readonly<Record<string, string>> = {
  '@critical': '@p0',
  '@high': '@p1',
  '@medium': '@p2',
  '@happy': '@positive',
  '@happy-path': '@positive',
  '@success': '@positive',
  '@error': '@negative',
  '@edge': '@boundary',
  '@edge-case': '@boundary',
  '@business_rule': '@business-rule',
  '@businessrule': '@business-rule',
  '@login': '@feature-dang-nhap',
  '@search': '@feature-tim-kiem-bang-gia',
  '@my-asset-bond': '@feature-tai-san-trai-phieu',
  '@hieu-qua-dau-tu': '@feature-hieu-qua-dau-tu',
  '@check-tooltip': '@feature-fundmart',
  '@draft-order': '@feature-dat-lenh',
  '@farm-debug': '@diagnostic',
};

const DEFINITION_BY_NAME = new Map(TAG_DEFINITIONS.map((item) => [item.name, item]));
const CATEGORY_ORDER: TagCategory[] = ['feature', 'priority', 'suite', 'type', 'platform', 'operation'];

export function tagTaxonomyView(): TagTaxonomyView {
  return {
    version: 1,
    definitions: [...TAG_DEFINITIONS],
    featurePattern: '@feature-<ten-chuc-nang>',
    aliases: { ...TAG_ALIASES },
  };
}

export function tagPolicyPrompt(): string {
  return `\n\nTAG POLICY BẮT BUỘC\n` +
    `- Không tự nghĩ tag mới. Tag chức năng dùng đúng dạng @feature-<slug>.\n` +
    `- Mỗi scenario có đúng một priority: @p0, @p1 hoặc @p2.\n` +
    `- Mỗi scenario có đúng một loại: @positive, @negative, @boundary hoặc @business-rule.\n` +
    `- Chỉ thêm @smoke cho happy path P0.\n` +
    `- Chỉ thêm @web, @android hoặc @ios khi hành vi nghiệp vụ khác theo nền tảng.\n` +
    `- Không dùng trạng thái workflow như generated, pending, approved, rejected làm tag.`;
}

export function featureTag(name: string): string {
  const businessName = name.trim().replace(/^(?:chức năng|kiểm tra)\s+/iu, '');
  return `@feature-${tagSlug(businessName || name) || 'chua-dat-ten'}`;
}

/** Unknown user tags become namespaced feature tags instead of global junk. */
export function canonicalTag(raw: string): string {
  const body = raw.trim().replace(/^@+/, '');
  if (!body) return '';
  const normalized = `@${tagSlug(body)}`;
  if (!normalized || normalized === '@') return '';
  const aliased = TAG_ALIASES[normalized] ?? normalized;
  if (DEFINITION_BY_NAME.has(aliased) || /^@feature-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(aliased)) {
    return aliased;
  }
  return `@feature-${tagSlug(aliased.slice(1))}`;
}

export function tagCategory(tag: string): TagCategory {
  const canonical = canonicalTag(tag);
  if (canonical.startsWith('@feature-')) return 'feature';
  return DEFINITION_BY_NAME.get(canonical)?.category ?? 'feature';
}

export function normalizeTagList(tags: readonly string[]): string[] {
  const normalized = [...new Set(tags.map(canonicalTag).filter(Boolean))];
  // One priority and one behavioural type per scenario. If invalid input gives
  // several priorities, retain the most important; this is deterministic and
  // prevents a scenario from being both P0 and P2 in filters.
  const priorities = normalized.filter((tag) => tagCategory(tag) === 'priority');
  const selectedPriority = ['@p0', '@p1', '@p2'].find((tag) => priorities.includes(tag));
  const types = normalized.filter((tag) => tagCategory(tag) === 'type');
  const selectedType = types[0];
  return normalized
    .filter((tag) => tagCategory(tag) !== 'priority' || tag === selectedPriority)
    .filter((tag) => tagCategory(tag) !== 'type' || tag === selectedType)
    .sort((a, b) => {
      const category = CATEGORY_ORDER.indexOf(tagCategory(a)) - CATEGORY_ORDER.indexOf(tagCategory(b));
      return category || a.localeCompare(b);
    });
}

/** Canonicalise all existing/manual tag lines without touching Gherkin steps. */
export function normalizeFeatureTags(content: string): { content: string; changed: boolean } {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  let changed = false;
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseTagLine(lines[index]);
    if (!parsed) continue;
    const next = `${parsed.indent}${normalizeTagList(parsed.tags).join(' ')}`;
    if (next !== lines[index]) {
      lines[index] = next;
      changed = true;
    }
  }
  return { content: lines.join(newline), changed };
}

interface RequirementLike {
  id: string;
  priority: 'P0' | 'P1';
  rule: string;
  expectedResult: string;
}

interface MappingLike {
  requirementId: string;
  scenarios: string[];
}

/**
 * Apply deterministic tags after the coverage audit has identified which
 * requirements each generated scenario proves. AI wording is not trusted as
 * taxonomy metadata.
 */
export function applyGeneratedTagPolicy(
  content: string,
  featureName: string,
  requirements: readonly RequirementLike[],
  mappings: readonly MappingLike[],
): string {
  const canonical = normalizeFeatureTags(content).content;
  const newline = canonical.includes('\r\n') ? '\r\n' : '\n';
  const lines = canonical.split(/\r?\n/);
  const featureIndex = lines.findIndex((line) => /^\s*Feature\s*:/i.test(line));
  if (featureIndex < 0) return canonical;

  replaceTagsBefore(lines, featureIndex, [featureTag(featureName)]);

  const requirementById = new Map(requirements.map((item) => [item.id, item]));
  const scenarioIndexes = lines
    .map((line, index) => (/^\s*Scenario(?:\s+Outline)?\s*:/i.test(line) ? index : -1))
    .filter((index) => index >= 0);

  // Work bottom-up because replacing tag rows changes following line indexes.
  for (const scenarioIndex of scenarioIndexes.reverse()) {
    const header = lines[scenarioIndex];
    if (!header) continue;
    const name = header.replace(/^\s*Scenario(?:\s+Outline)?\s*:\s*/i, '').trim();
    const mapped = mappings
      .filter((mapping) => mapping.scenarios.some((scenario) => sameText(scenario, name)))
      .map((mapping) => requirementById.get(mapping.requirementId))
      .filter((item): item is RequirementLike => Boolean(item));
    const priority = mapped.some((item) => item.priority === 'P0') ? '@p0' : mapped.length ? '@p1' : '@p2';
    const type = scenarioType(name, mapped);
    const previous = tagsBefore(lines, scenarioIndex);
    const platform = previous.filter((tag) => tagCategory(tag) === 'platform');
    const operation = previous.filter((tag) => tagCategory(tag) === 'operation');
    const tags = normalizeTagList([
      priority,
      ...(priority === '@p0' && type === '@positive' ? ['@smoke'] : []),
      type,
      ...platform,
      ...operation,
    ]);
    replaceTagsBefore(lines, scenarioIndex, tags);
  }
  return lines.join(newline);
}

function scenarioType(name: string, requirements: readonly RequirementLike[]): string {
  const text = [name, ...requirements.flatMap((item) => [item.rule, item.expectedResult])]
    .join(' ')
    .toLocaleLowerCase('vi-VN');
  if (/\b(tối đa|tối thiểu|giới hạn|ngưỡng|giá trị biên|độ dài|rỗng)\b/iu.test(text)) return '@boundary';
  if (/\b(tự động|lọc trùng|không trùng|phân quyền|chỉ được|không được phép)\b/iu.test(text)) {
    return '@business-rule';
  }
  if (/\b(thất bại|không hợp lệ|bị từ chối|báo lỗi|không thể|sai thông tin)\b/iu.test(text)) {
    return '@negative';
  }
  return '@positive';
}

function tagsBefore(lines: string[], index: number): string[] {
  const tags: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const parsed = parseTagLine(lines[cursor]);
    if (!parsed) break;
    tags.unshift(...parsed.tags);
  }
  return normalizeTagList(tags);
}

function replaceTagsBefore(lines: string[], index: number, tags: string[]): void {
  let start = index;
  while (start > 0 && parseTagLine(lines[start - 1])) start -= 1;
  const indent = lines[index]?.match(/^\s*/)?.[0] ?? '';
  lines.splice(start, index - start, ...(tags.length ? [`${indent}${tags.join(' ')}`] : []));
}

function parseTagLine(line: string | undefined): { indent: string; tags: string[] } | undefined {
  if (line == null) return undefined;
  const match = line.match(/^(\s*)((?:@[^\s]+\s*)+)$/);
  if (!match) return undefined;
  return { indent: match[1] ?? '', tags: (match[2] ?? '').trim().split(/\s+/) };
}

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN') ===
    b.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
}

function tagSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}
