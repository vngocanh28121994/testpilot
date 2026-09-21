/**
 * Chuẩn hoá một bản nháp Gherkin: kế hoạch kịch bản, nở macro, sửa câu chữ.
 *
 * Đây là logic SINH NỘI DUNG, không phải logic HTTP — nó nằm trong
 * `src/ui/server.ts` chỉ vì endpoint gọi nó ở đó. Lần đầu thử chuyển (nhóm 3)
 * mình đã lùi lại: nhìn thì route chỉ sáu dòng, nhưng nó kéo theo cả cụm này,
 * và trộn việc ấy vào một commit đang chuyển bốn route khác là cách chắc chắn
 * để không biết lỗi từ đâu. Giờ nó là commit của chính nó.
 *
 * Nội dung giữ nguyên từng dòng, kể cả bộ ví dụ mẫu — phần đắt nhất ở đây là
 * những ví dụ ấy, vì chúng là thứ ngăn model trả lời một câu Gherkin đọc thì
 * xuôi mà không bước nào chạy được.
 */
import { completeJson, llmAvailable, missingKeyHint, pickModel } from '../llm/client.js';
import { Registry } from '../core/registry.js';
import { ActionRegistry, validateExecutableAction, type LearnedActionDef, type LearnedActionKind } from '../actions/ActionRegistry.js';
import { expandApprovedActions } from '../actions/expandActions.js';
import { normalizeNaturalSteps, registerMissingElementIntents } from '../steps/normalizer.js';
import {
  applyScenarioPlan,
  deterministicScenarioPlan,
  planningInput,
  validateScenarioPlan,
  type RawScenarioPlan,
  type ScenarioPlan,
} from '../steps/scenarioPlan.js';
import { firstJsonObject } from '../llm/json.js';
import { prepareExecutableDraft } from './draft.js';
import { parseFeature } from '../steps/binding.js';
import { vocabularyDoc } from '../steps/vocabulary.js';
import type { FeatureNormalizeResponse } from '../ui/contracts.js';

/**
 * Kết quả chuẩn hoá, đúng hình dạng mà trình duyệt nhận.
 *
 * Lấy thẳng từ contracts thay vì khai lại: hai bản khai song song là cách một
 * field bị đổi ở đây mà giao diện vẫn tưởng nó còn nguyên.
 */
export type DraftNormalization = FeatureNormalizeResponse & { scenarioPlan: ScenarioPlan }

/**
 * Worked examples for the normalizer prompt.
 *
 * The rules alone leave too much room: a model happily answers
 * `I tap "Đăng nhập" button`, which reads fine and matches no executable form.
 * Showing the shape is what stops that, so each example is a full request and
 * the exact reply it should produce — including the ones where the right answer
 * is to propose a macro, or to return nothing at all.
 */
const NORMALIZE_EXAMPLES: Array<{
  in: { unresolved: Array<{ line: number; text: string }>; registry: Array<{ id: string; label: string }> };
  out: unknown;
}> = [
  {
    // The label is copied verbatim — no "button" appended, nothing translated.
    in: {
      unresolved: [{ line: 4, text: 'bấm vào nút Đăng nhập' }],
      registry: [{ id: 'login.submit', label: 'Nút đăng nhập' }],
    },
    out: {
      replacements: [{
        line: 4,
        step: 'I tap "Nút đăng nhập"',
        reason: 'Bấm nút = tap',
      }],
      actionProposals: [],
    },
  },
  {
    // Values stay exactly as written, placeholders included.
    in: {
      unresolved: [{ line: 5, text: 'gõ {{account.tcbs.username}} vào ô tài khoản' }],
      registry: [{ id: 'login.usernameField', label: 'Ô tên đăng nhập' }],
    },
    out: {
      replacements: [{
        line: 5,
        step: 'I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"',
        reason: 'Gõ vào ô nhập = enter into',
      }],
      actionProposals: [],
    },
  },
  {
    in: {
      unresolved: [{ line: 6, text: 'chọn Ký quỹ ở dropdown Tiểu khoản' }],
      registry: [{ id: 'home.tieuKhoan', label: 'Tiểu khoản' }],
    },
    out: {
      replacements: [{
        line: 6,
        step: 'I select "Ký quỹ" from "Tiểu khoản"',
        reason: 'Chọn giá trị trong dropdown = select from',
      }],
      actionProposals: [],
    },
  },
  {
    in: {
      unresolved: [{ line: 7, text: 'màn hình phải hiện Tổng tài sản' }],
      registry: [{ id: 'home.tongTaiSan', label: 'Tổng tài sản' }],
    },
    out: {
      replacements: [{
        line: 7,
        step: '"Tổng tài sản" is visible',
        reason: 'Kiểm tra hiển thị',
      }],
      actionProposals: [],
    },
  },
  {
    // No element in the registry carries this meaning, so nothing is invented:
    // the line comes back untouched and stays visible to the reviewer.
    in: {
      unresolved: [{ line: 8, text: 'kiểm tra số dư đúng như trong core banking' }],
      registry: [{ id: 'home.tongTaiSan', label: 'Tổng tài sản' }],
    },
    out: { replacements: [], actionProposals: [] },
  },
  {
    // Several operations in one sentence: a macro, never a lossy single step.
    in: {
      unresolved: [{ line: 9, text: 'tìm kiếm "Tài sản của tôi"' }],
      registry: [
        { id: 'home.searchButton', label: 'Nút tìm kiếm' },
        { id: 'home.searchInput', label: 'Ô tìm kiếm' },
        { id: 'home.firstResult', label: 'Kết quả tìm kiếm đầu tiên' },
      ],
    },
    out: {
      replacements: [],
      actionProposals: [{
        line: 9,
        label: 'Tìm kiếm',
        kind: 'macro',
        phraseTemplate: 'tìm kiếm "{{keyword}}"',
        parameters: [{ name: 'keyword', example: 'Tài sản của tôi' }],
        expansion: [
          'I tap "Nút tìm kiếm"',
          'I enter "{{keyword}}" into "Ô tìm kiếm"',
          'I wait for "Kết quả tìm kiếm đầu tiên"',
        ],
        postcondition: '"Kết quả tìm kiếm đầu tiên" is visible',
        reason: 'Một câu gộp ba thao tác',
      }],
    },
  },
];

function collapseDuplicateFocusRegions(content: string): string {
  const output: string[] = [];
  let previousRegion = '';
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*(?:Given|When|Then|And|But)\s+I inspect section "([^"]+)"\s*$/iu);
    const region = match?.[1]?.trim().toLocaleLowerCase('vi-VN') ?? '';
    if (region && region === previousRegion) continue;
    output.push(line);
    previousRegion = region;
  }
  return output.join('\n');
}

/**
 * AI reads the complete business flow, not only syntax failures. Its result is
 * an untrusted semantic plan: validation rejects invented targets/selectors,
 * and applyScenarioPlan can only emit controlled structural intents.
 */
async function compileScenarioPlan(content: string, model: string): Promise<ScenarioPlan> {
  const fallback = deterministicScenarioPlan(content);
  if (!llmAvailable()) return fallback;
  try {
    const text = await completeJson({
      model,
      maxTokens: 1_800,
      system: [
        'You are a senior QA analyst compiling a natural-language scenario into a semantic test plan.',
        'Return JSON only: {"goal":string,"screen":string,"preconditions":string[],"reusableFlows":string[],"steps":[{"line":number,"kind":"precondition"|"navigation"|"focusRegion"|"action"|"assertion","target":string,"scope":string,"action":string,"expectedResult":string,"confidence":number,"reason":string}],"warnings":string[]}.',
        'Do not return Gherkin, CSS, XPath, test ids, code, coordinates or implementation details.',
        'Targets and scopes must be exact business phrases occurring in the supplied scenario. Never invent a UI name.',
        'Return exactly one steps[] item for every supplied step line, in the same order. Do not omit assertions.',
        'A phrase meaning “inspect/check a section, area, table or business block” is focusRegion, not merely a visibility assertion. That region remains scope for following actions until navigation or another focusRegion.',
        'A sentence explicitly saying visible/appears/not visible or comparing a value is an assertion, not a scope.',
        'If one sentence contains both a region and an action target, keep target and scope separately.',
        'Identify reusable preconditions/flows such as login and opening a feature from Homepage search.',
        'expectedResult states the observable business outcome; do not fabricate one when the ticket gives none.',
        'Use confidence below 0.8 whenever the wording is ambiguous. The framework will not compile low-confidence structure automatically.',
        'Write reason and warnings in Vietnamese so a non-technical end user can review them.',
        'Credential-bearing lines may be redacted. Treat them only as a local login precondition; never request or infer secret values.',
      ].join('\n'),
      user: JSON.stringify(planningInput(content)),
    });
    const parsed = safeJson<RawScenarioPlan>(text);
    return validateScenarioPlan(parsed, content) ?? fallback;
  } catch (err) {
    console.warn(`[scenario-plan] AI planning failed; using deterministic plan: ${(err as Error).message}`);
    return {
      ...fallback,
      warnings: [...fallback.warnings, 'AI chưa phân tích được; đang dùng kế hoạch cục bộ an toàn.'],
    };
  }
}

function isSensitiveStep(text: string): boolean {
  return /password|mật\s*khẩu|secret|token|api[_ -]?key/i.test(text);
}

function validateScenarioDraft(block: string, registry: Registry): string | undefined {
  try {
    parseFeature('scenario-editor.feature', `Feature: Scenario editor\n\n${block.trim()}\n`, registry);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

function safeJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    // Cùng bộ tách với genspec: lấy từ `{` đầu tới `}` cuối là ôm luôn cả hai
    // đối tượng khi có hai, rồi hỏng đúng lúc lẽ ra vẫn cứu được.
    try { return JSON.parse(firstJsonObject(value)) as T; } catch { return undefined; }
  }
}

/**
 * Converts editor-friendly wording into the small executable language. The
 * deterministic rules still handle common phrasing locally, but the semantic
 * planner reads the whole scenario first. Any unresolved syntax is then
 * normalized and re-bound against the actual registry before it is returned.
 */
export async function normalizeFeatureDraft(
  content: string,
  registry: Registry,
  actions: ActionRegistry,
  model: string,
): Promise<DraftNormalization> {
  const scenarioPlan = await compileScenarioPlan(content, model);
  const planned = applyScenarioPlan(content, scenarioPlan);
  const learned = expandApprovedActions(planned.content, actions);
  let result = normalizeNaturalSteps(learned.content, registry);
  const changes = [...planned.changes, ...learned.changes, ...result.changes];
  let usedAi = scenarioPlan.source === 'ai';
  const actionProposals: LearnedActionDef[] = [];
  const aiAvailable = llmAvailable();

  // Never send a password/token-bearing step to an external model. Those lines
  // remain visible to the reviewer as unresolved and can be edited locally.
  const aiCandidates = result.unresolved.filter((item) => !isSensitiveStep(item.text));
  if (aiCandidates.length > 0 && aiAvailable) {
    const normalizedLines = result.content.split('\n');
    const contextualCandidates = aiCandidates.map((item) => {
      const neighboringStep = (direction: -1 | 1): string | undefined => {
        for (let index = item.line - 1 + direction; index >= 0 && index < normalizedLines.length; index += direction) {
          const match = normalizedLines[index]?.match(/^\s*(?:Given|When|Then|And|But)\s+(.+)$/iu);
          if (match) return match[1]!.trim();
        }
        return undefined;
      };
      return {
        ...item,
        ...(neighboringStep(-1) ? { previousStep: neighboringStep(-1) } : {}),
        ...(neighboringStep(1) ? { nextStep: neighboringStep(1) } : {}),
      };
    });
    const candidates = Object.values(registry.raw.elements).map((el) => ({ id: el.id, label: el.label }));
    const text = await completeJson({
      model,
      maxTokens: 1_200,
      system: [
        'You normalize human-authored Gherkin steps for a test runner.',
        'Return JSON only with this shape: {"replacements":[{"line":number,"step":string,"reason":string}],"actionProposals":[{"line":number,"label":string,"kind":"alias"|"macro"|"primitive","phraseTemplate":string,"parameters":[{"name":string,"example":string}],"expansion":string[],"postcondition":string,"reason":string}]}.',
        'Replace only the supplied unresolved lines. Keep values and quoted element references intact.',
        'Use replacements only when one existing action expresses the exact meaning.',
        'When the meaning requires several operations, propose a reusable macro instead of silently dropping behavior.',
        'A macro phraseTemplate replaces variable values with {{camelCaseParameter}} and expansion reuses those placeholders.',
        'The phraseTemplate must keep the source language and sentence shape so it matches sourceExample after substituting parameters.',
        'Each unresolved item may include previousStep and nextStep. Do not repeat setup already performed by previousStep or consume behavior belonging to nextStep.',
        'Every macro needs a postcondition that proves its result. All expansion and postcondition lines must use the executable forms below.',
        'Executable forms, one per line — a step must match one of them exactly:',
        vocabularyDoc(),
        'Never add a word that no form contains, such as "button", "field", "icon" or "screen".',
        'Never translate: the input is Vietnamese, the step keywords stay English and the quoted element stays exactly as the registry spells it, diacritics and capitalisation included.',
        'Prefer an exact element id or label from the registry below when one expresses the same business target.',
        'If the source clearly names a UI target that is not in the registry, preserve only that user-visible business phrase as the quoted <element>. Do not invent a button type, selector, test id, screen hierarchy, position, or implementation detail. The runtime Playwright discovery will resolve this selector-less logical element from the live DOM.',
        'If the source does not identify even a semantic target or a safe postcondition, omit that line — unresolved is better than guessing.',
        'Use kind=primitive only when the requested interaction cannot be composed from the executable forms. Primitive proposals cannot be approved until a driver adapter exists.',
        'Worked examples. Each pair is a full request and the exact reply it must produce:',
        ...NORMALIZE_EXAMPLES.map(
          (example) => `IN ${JSON.stringify(example.in)}\nOUT ${JSON.stringify(example.out)}`,
        ),
      ].join('\n'),
      user: JSON.stringify({
        unresolved: contextualCandidates,
        registry: candidates,
      }),
    });
    const parsed = safeJson<{
      replacements?: Array<{ line?: number; step?: string; reason?: string }>;
      actionProposals?: Array<{
        line?: number;
        label?: string;
        kind?: LearnedActionKind;
        phraseTemplate?: string;
        parameters?: Array<{ name?: string; example?: string }>;
        expansion?: string[];
        postcondition?: string;
        reason?: string;
      }>;
    }>(text);
    const replacements = parsed?.replacements ?? [];
    if (replacements.length > 0) {
      const lines = result.content.split('\n');
      for (const replacement of replacements) {
        const index = Number(replacement.line) - 1;
        const oldLine = lines[index];
        if (!oldLine || !replacement.step) continue;
        const match = oldLine.match(/^(\s*(?:Given|When|Then|And|But)\s+).+$/i);
        if (!match) continue;
        lines[index] = `${match[1]}${replacement.step.trim()}`;
        changes.push({
          line: replacement.line!,
          from: oldLine.trim(),
          to: lines[index]!.trim(),
          reason: replacement.reason?.trim() || 'AI chuẩn hoá câu tự nhiên',
        });
      }
      result = normalizeNaturalSteps(lines.join('\n'), registry);
      changes.push(...result.changes);
      usedAi = true;
    }
    for (const proposal of parsed?.actionProposals ?? []) {
      const source = result.unresolved.find((item) => item.line === proposal.line)?.text;
      if (!source || !proposal.label || !proposal.phraseTemplate || !proposal.kind) continue;
      const proposalInput = {
        label: proposal.label.trim(),
        kind: proposal.kind,
        phraseTemplate: proposal.phraseTemplate.trim(),
        parameters: (proposal.parameters ?? [])
          .filter((param) => param.name && param.example !== undefined)
          .map((param) => ({ name: param.name!.trim(), example: param.example!.trim() })),
        expansion: (proposal.expansion ?? []).map((step) => step.trim()).filter(Boolean),
        ...(proposal.postcondition?.trim() ? { postcondition: proposal.postcondition.trim() } : {}),
        ...(proposal.reason?.trim() ? { reason: proposal.reason.trim() } : {}),
        sourceExample: source,
      };
      if (proposalInput.kind !== 'primitive') {
        const validationError = validateExecutableAction({
          ...proposalInput,
          id: 'proposal-validation',
          status: 'proposed',
          createdAt: new Date(0).toISOString(),
        });
        if (validationError) continue;
      }
      const candidate = actions.propose(proposalInput);
      if (candidate.status === 'proposed') actionProposals.push(candidate);
    }
    if (actionProposals.length > 0) {
      usedAi = true;
      await actions.save();
    }
  }

  // A semantic sentence may be split into “focus this region” + action while
  // the preceding natural sentence normalizes to the same focus. Keep one
  // anchor only; duplicate anchors add no execution value and make the editor
  // look as if AI invented an extra business step.
  const compacted = collapseDuplicateFocusRegions(result.content);
  if (compacted !== result.content) result = normalizeNaturalSteps(compacted, registry);

  // Missing logical elements are accepted here without inventing selectors.
  // Playwright/CDP discovers and verifies the real locator when this step is
  // reached on the live screen, then the run persists it for later reuse.
  let pending = registerMissingElementIntents(result.content, registry);
  if (pending.length > 0) await registry.save();

  let validation = validateScenarioDraft(result.content, registry);
  // The editor and workflow now share the same last-mile compiler. Users may
  // write business language; parser/binding repair remains an internal task.
  if (validation) {
    try {
      const prepared = await prepareExecutableDraft(result.content, registry, {
        model,
        uri: 'scenario-editor.feature',
        maxRepairs: 2,
      });
      if (prepared.content !== result.content) {
        changes.push({
          line: 0,
          from: 'Bản nháp nghiệp vụ',
          to: 'Bản có thể thực thi',
          reason: 'AI tự sửa lỗi cú pháp/binding trước khi lưu',
        });
      }
      result = normalizeNaturalSteps(prepared.content, registry);
      usedAi ||= prepared.repaired;
      pending = prepared.pendingElements.map((item) => registry.element(item.id));
      await registry.save();
      validation = validateScenarioDraft(result.content, registry);
    } catch {
      // Keep the richer existing editor diagnosis when last-mile repair cannot
      // prove executability; never replace it with raw parser/registry details.
    }
  }
  return {
    content: result.content,
    changes,
    unresolved: result.unresolved,
    valid: !validation,
    ...(validation ? { error: validation } : {}),
    usedAi,
    discoveredLater: pending.map(({ id, label, screen }) => ({ id, label, screen })),
    actionProposals,
    appliedActions: learned.applied,
    actionAnalysis: {
      available: aiAvailable,
      attempted: aiCandidates.length > 0 && aiAvailable,
      ...(!aiAvailable && aiCandidates.length > 0
        ? { reason: `${missingKeyHint()} Không thể phân tích action mới.` }
        : {}),
    },
    scenarioPlan,
  };
}
