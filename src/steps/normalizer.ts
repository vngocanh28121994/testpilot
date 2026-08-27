import { STEP_RULES } from './vocabulary.js';
import type { ElementDef } from '../core/types.js';
import { xpathLiteral } from '../core/labelXPath.js';
import type { Registry } from '../core/registry.js';
import {
  contextualRowActionTemplateCandidates,
  isOverflowRowAction,
  parseContextualRowAction,
} from '../core/contextual.js';
import { normalizeHumanText } from '../core/text.js';

export interface NaturalStepChange {
  line: number;
  from: string;
  to: string;
  reason: string;
}

export interface NaturalStepResult {
  content: string;
  changes: NaturalStepChange[];
  unresolved: Array<{ line: number; text: string }>;
}

/**
 * Makes common human wording executable without broadening the runtime
 * grammar. This deliberately does not guess an element id: resolving the
 * quoted reference remains the registry's responsibility.
 */
export function normalizeNaturalSteps(content: string): NaturalStepResult {
  const changes: NaturalStepChange[] = [];
  const unresolved: Array<{ line: number; text: string }> = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  const normalized: string[] = [];
  lines.forEach((line, i) => {
    const match = line.match(/^(\s*)(Given|When|Then|And|But)\s+(.+)$/i);
    if (!match) {
      normalized.push(line);
      return;
    }

    const indent = match[1] ?? '';
    const keyword = match[2] ?? '';
    const original = match[3] ?? '';
    const steps = canonicalStep(original.trim()).split('\n').map((step) => step.trim()).filter(Boolean);
    if (steps.join('\n') !== original.trim()) {
      changes.push({
        line: i + 1,
        from: original.trim(),
        to: steps.join(' → '),
        reason: steps.length > 1 ? 'Mở rộng thao tác nghiệp vụ' : 'Chuẩn hoá cách diễn đạt thao tác',
      });
    }
    steps.forEach((text, stepIndex) => {
      if (!matchesVocabulary(text)) unresolved.push({ line: i + 1, text });
      normalized.push(`${indent}${stepIndex === 0 ? keyword : 'And'} ${text}`);
    });
  });

  return { content: normalized.join('\n'), changes, unresolved };
}

/** True when text already maps to a runtime intent; element existence is checked later. */
export function matchesVocabulary(text: string): boolean {
  return STEP_RULES.some((rule) => rule.patterns.some((pattern) => pattern.test(text.trim())));
}

/**
 * Creates selector-less logical elements for references introduced by a human.
 * The runtime discovery pipeline will resolve them from the live DOM and store
 * the verified Playwright locator. Users therefore never need to author CSS,
 * XPath, test ids, or registry JSON themselves.
 */
export function registerMissingElementIntents(content: string, registry: Registry): ElementDef[] {
  const known = new Map<string, ElementDef>();
  const byLabel = new Map<string, ElementDef[]>();
  for (const element of Object.values(registry.raw.elements)) {
    known.set(element.id.toLowerCase(), element);
    if (!known.has(element.label.toLowerCase())) known.set(element.label.toLowerCase(), element);
    const label = element.label.toLocaleLowerCase('vi-VN');
    byLabel.set(label, [...(byLabel.get(label) ?? []), element]);
  }

  // Return every referenced element that still has no selector, not only the
  // ones created during this invocation. This keeps the editor honest when a
  // user presses "Chuẩn hoá" more than once: Playwright still has work to do
  // until runtime discovery has persisted a verified locator.
  const pending = new Map<string, ElementDef>();
  let currentScreen = '';
  const dynamicValues = new Set<string>();

  const registerReference = (reference: { label: string; establishesScreen: boolean }): void => {
    const labelKey = reference.label.toLocaleLowerCase('vi-VN');
    const labelMatches = byLabel.get(labelKey) ?? [];
    const existing = (currentScreen
      ? labelMatches.find((element) => element.screen === currentScreen)
      : undefined) ?? known.get(reference.label.toLowerCase()) ??
      (labelMatches.length === 1 ? labelMatches[0] : undefined);
    const contextual = parseContextualRowAction(reference.label);
    if (contextual) {
      const screen = currentScreen || existing?.screen || 'auto';
      const templateId = contextualTemplateId(screen, contextual.action);
      let template = registry.raw.elements[templateId];
      if (!template) {
        template = {
          id: templateId,
          label: `Icon ${contextual.action} tại dòng {{rowText}}`,
          provenance: 'byproduct',
          screen,
          template: { kind: 'rowAction', action: contextual.action },
          candidates: { web: contextualRowActionTemplateCandidates(contextual.action) },
        };
        registry.upsertElement(template);
      }
      known.set(reference.label.toLowerCase(), template);
      currentScreen = screen;
      return;
    }
    if (dynamicValues.has(reference.label.toLocaleLowerCase())) {
      const screen = currentScreen || existing?.screen || 'auto';
      const template = ensureDynamicTextTemplate(registry, screen);
      known.set(reference.label.toLocaleLowerCase(), template);
      currentScreen = screen;
      return;
    }
    if (existing) {
      seedContextualCandidate(existing, reference.label, registry);
      const hasCandidate = Object.values(existing.candidates)
        .some((items) => (items?.length ?? 0) > 0);
      if (!hasCandidate) pending.set(existing.id, existing);
      // Historical `auto.*` elements mean "screen unknown" and must not erase
      // a concrete feature context established by a business navigation step.
      if ((!currentScreen || reference.establishesScreen) && existing.screen !== 'auto') {
        currentScreen = existing.screen;
      }
      return;
    }

    const screen = currentScreen || 'auto';
    const id = uniqueElementId(registry, screen, reference.label);
    // Minted only because a scenario named a label nothing recognised. This is
    // the one kind of element a cleanup rule may remove without asking.
    const element: ElementDef = {
      id, label: reference.label, screen, candidates: {}, provenance: 'byproduct',
    };
    seedContextualCandidate(element, reference.label, registry);
    registry.upsertElement(element);
    known.set(id.toLowerCase(), element);
    known.set(reference.label.toLowerCase(), element);
    byLabel.set(labelKey, [...labelMatches, element]);
    pending.set(element.id, element);
  };

  for (const line of content.split('\n')) {
    const match = line.trim().match(/^(?:Given|When|Then|And|But)\s+(.+)$/i);
    if (!match) continue;
    const stepText = match[1] ?? '';
    const feature = stepText.match(/^I open feature "([^"]+)" from search$/iu)?.[1];
    if (feature) currentScreen = screenForFeature(feature, registry) ?? currentScreen;
    const entered = enteredRuntimeValue(stepText);
    if (entered) dynamicValues.add(entered.toLocaleLowerCase());
    for (const reference of elementReferences(stepText)) registerReference(reference);
  }

  return [...pending.values()];
}

function screenForFeature(feature: string, registry: Registry): string | undefined {
  const wanted = normalizeHumanText(feature);
  const exact = Object.values(registry.raw.screens).find((screen) =>
    normalizeHumanText(screen.title) === wanted,
  );
  if (exact) return exact.id;
  const partial = Object.values(registry.raw.screens).filter((screen) => {
    const title = normalizeHumanText(screen.title);
    return title.includes(wanted) || wanted.includes(title);
  });
  return partial.length === 1 ? partial[0]!.id : undefined;
}

function ensureDynamicTextTemplate(registry: Registry, screen: string): ElementDef {
  const id = `${screen}.dynamicText`;
  const existing = registry.raw.elements[id];
  if (existing) return existing;
  const template: ElementDef = {
    id,
    label: '{{text}}',
    screen,
    template: { kind: 'text' },
    candidates: {
      web: [{ strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored' }],
      android: [{ strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored' }],
      ios: [{ strategy: 'label', value: '{{text}}', weight: 0.9, origin: 'authored' }],
    },
  };
  registry.upsertElement(template);
  return template;
}

function enteredRuntimeValue(text: string): string | undefined {
  const match = text.match(/^I (?:enter|type) "([^"]+)" (?:in|into) "[^"]+"$/i);
  const value = match?.[1]?.trim();
  if (!value || /^\{\{.+\}\}$/.test(value)) return undefined;
  return value;
}

function contextualTemplateId(screen: string, action: string): string {
  return isOverflowRowAction(action)
    ? `${screen}.rowActionMenu`
    : `${screen}.rowAction${capitalize(camel(action))}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function seedContextualCandidate(element: ElementDef, label: string, registry: Registry): void {
  const dateCaption = label.match(/^Ngày\s+(.+)$/iu)?.[1]?.trim();
  if (dateCaption) {
    const caption = xpathLiteral(dateCaption);
    registry.upsertElement({
      ...element,
      candidates: {
        web: [{
          strategy: 'xpath',
          value:
            `(//*[normalize-space(text())=${caption}]` +
            `/following-sibling::*[1]//input[@data-mat-calendar or @type='date'])[1]`,
          weight: 0.88,
          origin: 'authored',
        }],
      },
    });
    return;
  }
  // Business assertions commonly name a metric as "số lượng giao dịch" while
  // the UI renders the value and caption as sibling nodes: `33` / `Giao dịch`.
  // Resolve the value relative to that caption so the feature stays at business
  // level and does not need to describe CSS classes or DOM structure.
  const metricCaption = label.match(/^số lượng\s+(.+)$/iu)?.[1]?.trim();
  if (metricCaption) {
    const visibleCaption = metricCaption.charAt(0).toLocaleUpperCase('vi-VN') + metricCaption.slice(1);
    const caption = xpathLiteral(visibleCaption);
    registry.upsertElement({
      ...element,
      candidates: {
        web: [{
          strategy: 'xpath',
          value:
            `(//*[not(*) and normalize-space(.)=${caption}]` +
            `/preceding-sibling::*[1][normalize-space(.)!=''])[1]`,
          weight: 0.86,
          origin: 'authored',
        }],
      },
    });
    return;
  }
  if (!parseContextualRowAction(label)) return;
  registry.upsertElement({
    ...element,
    candidates: {
      web: [{ strategy: 'label', value: label, weight: 0.8, origin: 'authored' }],
    },
  });
}

function elementReferences(text: string): Array<{ label: string; establishesScreen: boolean }> {
  let match = text.match(/^I drag "([^"]+)" (?:and drop (?:it )?|to )"([^"]+)"$/i);
  if (match?.[1] && match[2]) {
    return [
      { label: match[1], establishesScreen: false },
      { label: match[2], establishesScreen: false },
    ];
  }
  const reference = elementReference(text);
  return reference ? [reference] : [];
}

function elementReference(text: string): { label: string; establishesScreen: boolean } | undefined {
  let match = text.match(/^I (?:enter|type) "[^"]*" (?:in|into) "([^"]+)"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: false };
  match = text.match(/^I select date "[^"]+" from "([^"]+)"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: false };
  match = text.match(/^I select "[^"]*" from "([^"]+)"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: false };
  match = text.match(/^I (?:tap|click|clear|long press|hover(?: over)?|scroll to) (?:on )?"([^"]+)"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: false };
  match = text.match(/^I wait for "([^"]+)"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^I inspect (?:the )?(?:section|region|area) "([^"]+)"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" is (?:not )?visible$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" (?:shows|hiển thị) "[^"]+" (?:exactly|đúng) "?\d+"? (?:times?|lần)$/iu);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" (?:does not show|does not contain|không chứa) "[^"]+"$/iu);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" (?:shows|contains|equals) "[^"]+"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" number is (?:not|equal to|greater than|at least|at most) "?\d+"?$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" (?:count is (?:not|equal to|greater than|at least|at most) "?\d+"?|values are unique|is focused)$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^first "([^"]+)" shows "[^"]+"$/i);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^"([^"]+)" (?:số lượng (?:khác|bằng|lớn hơn|ít nhất|tối đa) "[^"]+"|xuất hiện (?:khác|bằng|lớn hơn|ít nhất|tối đa) "[^"]+" lần|không có (?:kết quả )?trùng|được focus)$/iu);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  match = text.match(/^kết quả đầu tiên của "([^"]+)" chứa "[^"]+"$/iu);
  if (match?.[1]) return { label: match[1], establishesScreen: true };
  return undefined;
}

function uniqueElementId(registry: Registry, screen: string, label: string): string {
  const base = `${screen}.${camel(label)}`;
  if (!registry.raw.elements[base]) return base;
  let suffix = 2;
  while (registry.raw.elements[`${base}${suffix}`]) suffix += 1;
  return `${base}${suffix}`;
}

function camel(value: string): string {
  const words = value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'element';
  return words[0]!.toLowerCase() + words.slice(1)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join('');
}

function canonicalStep(text: string): string {
  // These are launch primitives, not semantic click targets. Keep deep links
  // intact even though the concise navigation grammar below also uses "open".
  if (/^I open (?:the app|"[^"]+")$/iu.test(text)) return text;
  // Business flows are already concise controlled steps. Keep them as one
  // reusable operation instead of letting the generic "open" rule below turn
  // them back into a raw click.
  if (/^I am logged in as "[^"]+"$/iu.test(text)) return text;
  if (/^I open feature "[^"]+" from search$/iu.test(text)) return text;
  const quoted = '"([^\"]+)"';
  const rules: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [
      /^(?:tôi|người dùng) đã đăng nhập bằng tài khoản "([^"]+)"$/iu,
      (m) => `I am logged in as "${m[1]}"`,
    ],
    [
      /^(?:tôi|người dùng) mở chức năng "([^"]+)"$/iu,
      (m) => `I open feature "${m[1]}" from search`,
    ],
    [
      /^(?:tôi|người dùng)\s+(?:thực hiện\s+)?tìm kiếm\s+"([^"]+)"\s+(?:ở|tại|trên)\s+(?:trang\s+)?homepage$/iu,
      (m) => [
        'I tap "Nút tìm kiếm"',
        `I enter "${m[1]}" into "Ô tìm kiếm"`,
        'I wait for "Kết quả tìm kiếm đầu tiên"',
      ].join('\n'),
    ],
    [
      /^(?:tôi|người dùng)\s+(?:bấm|nhấn|ấn|chạm)\s+"([^"]+)"\s+(?:ở|tại|trong)\s+(?:kết quả tìm kiếm|danh sách kết quả)$/iu,
      (m) => `I tap "${m[1]}"`,
    ],
    [
      /^I (?:tap|click) "ngày\s+([^"\s]+)\s+"([^"]+)""$/iu,
      (m) => `I select date "${m[2]}" from "Ngày ${m[1]}"`,
    ],
    [
      /^(?:tôi|người dùng)\s+(?:chọn|nhập)\s+ngày\s+(.+?)\s+(?:là\s+)?"([^"]+)"$/iu,
      (m) => `I select date "${m[2]}" from "Ngày ${semanticTarget(m[1]!)}"`,
    ],
    [new RegExp(`^I (?:tap|click) (?:on )?(?:the )?icon\\s+(.+?)\\s+(?:at|in|on|tại)\\s+(?:the )?(?:row|dòng)\\s+${quoted}$`, 'iu'), (m) => `I click "Icon ${m[1]!.trim()} tại dòng ${m[2]}"`],
    [new RegExp(`^I (?:tap|click) (?:on )?(?:the )?(?:button|link|icon|tab|menu item) ${quoted}$`, 'i'), (m) => `I click "${m[1]}"`],
    [new RegExp(`^(?:tôi )?(?:bấm|nhấn|chạm) (?:vào )?(?:nút|button|liên kết|icon|biểu tượng|tab) ${quoted}$`, 'i'), (m) => `I tap "${m[1]}"`],
    [new RegExp(`^I (?:fill|input) ${quoted} (?:in|into) (?:the )?(?:field|input|textbox) ${quoted}$`, 'i'), (m) => `I enter "${m[1]}" into "${m[2]}"`],
    [new RegExp(`^I (?:move (?:the )?mouse|hover) (?:over|on) ${quoted}$`, 'i'), (m) => `I hover "${m[1]}"`],
    [new RegExp(`^I drag and drop ${quoted} (?:to|into|onto) ${quoted}$`, 'i'), (m) => `I drag "${m[1]}" to "${m[2]}"`],
    [new RegExp(`^I scroll ${quoted} into view$`, 'i'), (m) => `I scroll to "${m[1]}"`],
    [new RegExp(`^I (?:see|verify|assert) ${quoted} (?:is )?visible$`, 'i'), (m) => `"${m[1]}" is visible`],
    [new RegExp(`^${quoted} is (?:unvisible|invisible|hidden)$`, 'i'), (m) => `"${m[1]}" is not visible`],

    // ── Concise semantic steps ──────────────────────────────────────────────
    // Generated requirements often say what the user wants to reach, not the
    // implementation detail they click ("truy cập phần Tài sản trái phiếu").
    // Preserve that business phrase as a selector-less logical element. The
    // live Playwright observation then resolves it by role/text/label/context;
    // users never have to add "button", CSS, XPath or a test id to the step.
    [
      /^I (?:open|go to|navigate to|access|choose) (?:the )?(?:(?:page|screen|section|menu|tab|item)\s+)?(.+)$/iu,
      (m) => semanticTap(m[1]!),
    ],
    [
      /^(?:tôi|người dùng) (?:mở|vào|truy cập|đi tới|chọn) (?:(?:màn hình|phần|mục|menu|tab)\s+)?(.+)$/iu,
      (m) => semanticTap(m[1]!),
    ],
    [
      /^I (?:tap|click) (?:on )?(?:the )?(?:(?:button|link|icon|tab|menu item)\s+)?(.+)$/iu,
      (m) => `I click "${semanticTarget(m[1]!)}"`,
    ],
    [
      /^(?:tôi|người dùng) (?:bấm|nhấn|chạm) (?:vào )?(?:(?:nút|button|liên kết|icon|biểu tượng|tab|mục)\s+)?(.+)$/iu,
      (m) => `I tap "${semanticTarget(m[1]!)}"`,
    ],
    [
      /^I (?:enter|type|fill) (.+?) (?:in|into) (?:the )?(?:(?:field|input|textbox)\s+)?(.+)$/iu,
      (m) => `I enter "${semanticValue(m[1]!)}" into "${semanticTarget(m[2]!)}"`,
    ],
    [
      /^(?:tôi|người dùng) nhập (.+?) vào (?:(?:ô|trường|input)\s+)?(.+)$/iu,
      (m) => `I enter "${semanticValue(m[1]!)}" into "${semanticTarget(m[2]!)}"`,
    ],
    [
      /^I wait for (?:the )?(.+)$/iu,
      (m) => `I wait for "${semanticTarget(m[1]!)}"`,
    ],
    [
      /^(?:tôi|người dùng) (?:chờ|đợi) (?:cho )?(.+?)(?: hiển thị| xuất hiện)?$/iu,
      (m) => `I wait for "${semanticTarget(m[1]!)}"`,
    ],
    [
      /^I (?:should )?see (?:the )?(.+)$/iu,
      (m) => `"${semanticTarget(m[1]!)}" is visible`,
    ],
    [
      /^(?:tôi|người dùng) (?:kiểm tra|xác nhận) (.+?) (?:hiển thị|xuất hiện)$/iu,
      (m) => `"${semanticTarget(m[1]!)}" is visible`,
    ],
    [
      /^(.+?)\s+(không\s+)?(?:hiển thị|xuất hiện)$/iu,
      (m) => `"${semanticTarget(m[1]!)}" is ${m[2] ? 'not ' : ''}visible`,
    ],
    [
      /^(?:tôi|người dùng) (?:kiểm tra|xác nhận) (.+)$/iu,
      (m) => `I inspect section "${semanticTarget(m[1]!)}"`,
    ],
    [
      /^"([^"]+)" (?:shows|contains) "(?:khác|không bằng)\s*0"$/iu,
      (m) => `"${m[1]}" number is not "0"`,
    ],
  ];
  for (const [pattern, replacement] of rules) {
    const match = text.match(pattern);
    if (match) {
      const normalized = replacement(match);
      // "I open the app" is already a launch primitive. Do not reinterpret it
      // as a click merely because the concise-navigation rule is intentionally
      // broad.
      if (/^I (?:tap|click) "(?:app|application|ứng dụng)"$/iu.test(normalized)) return text;
      return normalized;
    }
  }
  return text;
}

/** Remove syntax/UI filler while keeping the business name users recognise. */
function semanticTarget(raw: string): string {
  return unquote(raw)
    .replace(/[.!?]+$/u, '')
    .trim();
}

/** Values may already be quoted in an editor-friendly sentence. */
function semanticValue(raw: string): string {
  return unquote(raw).trim();
}

function semanticTap(raw: string): string {
  return `I tap "${semanticTarget(raw)}"`;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
