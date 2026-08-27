import type { FeatureSpec } from '../core/types.js';
import type { Registry } from '../core/registry.js';
import { completeText, llmAvailable } from '../llm/client.js';
import { parseFeature } from '../steps/binding.js';
import { normalizeNaturalSteps, registerMissingElementIntents } from '../steps/normalizer.js';
import { vocabularyDoc } from '../steps/vocabulary.js';
import { absoluteValueWarnings } from './absoluteValues.js';
import { extractGeneratedQuestions } from './openQuestions.js';

export interface PreparedDraft {
  content: string;
  spec: FeatureSpec;
  repaired: boolean;
  pendingElements: Array<{ id: string; label: string; screen: string }>;
}

export interface DraftPreparationOptions {
  model: string;
  uri: string;
  log?: (line: string) => void;
  maxRepairs?: number;
  /** Test seam; production uses the configured LLM client. */
  repair?: typeof completeText;
  /** Test seam; production derives availability from locally stored keys. */
  aiAvailable?: boolean;
  /**
   * Handed the draft that could not be compiled, with the reasons.
   *
   * The draft is deliberately kept out of the review list — an uncompilable
   * testcase must not look approvable. But discarding it entirely left the
   * workflow saying only "chạy lại", with the one artefact that could explain
   * the failure already gone.
   */
  onFailure?: (info: { content: string; problems: string[] }) => void | Promise<void>;
}

/**
 * Compile an AI/user draft before it is persisted or shown as executable.
 *
 * Natural wording is normalized locally first. Unknown logical controls are
 * registered without selectors so Playwright/Appium can discover them later.
 * Only technical syntax/binding failures enter the AI repair loop; the model is
 * explicitly forbidden from changing business meaning, coverage or selectors.
 */
export async function prepareExecutableDraft(
  source: string,
  registry: Registry,
  opts: DraftPreparationOptions,
): Promise<PreparedDraft> {
  let content = source;
  let repaired = false;
  const pending = new Map<string, { id: string; label: string; screen: string }>();
  const maxRepairs = Math.max(0, opts.maxRepairs ?? 2);
  const canRepair = opts.aiAvailable ?? llmAvailable();
  const repair = opts.repair ?? completeText;

  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    const normalized = normalizeNaturalSteps(content);
    content = normalized.content;
    for (const element of registerMissingElementIntents(content, registry)) {
      pending.set(element.id, { id: element.id, label: element.label, screen: element.screen });
    }

    const problems: string[] = normalized.unresolved.map(
      (item) => `Dòng ${item.line}: chưa hiểu thao tác “${item.text}”`,
    );
    let spec: FeatureSpec | undefined;
    try {
      spec = parseFeature(opts.uri, content, registry);
    } catch (err) {
      problems.push(safeCompilerMessage(err));
    }
    if (problems.length === 0 && spec) {
      // Not a compile problem, so it must not enter the repair loop — no
      // rewording fixes two controls sharing a name. It still has to be said.
      for (const warning of spec.warnings ?? []) opts.log?.(`⚠️  ${warning}`);
      // Said here rather than sent through the repair loop. A hardcoded balance
      // compiles and binds perfectly, so there is nothing for a rewrite pass to
      // fail on; what it needs is a person deciding whether that number is a
      // product rule or a snapshot of somebody's account.
      for (const warning of absoluteValueWarnings(spec)) opts.log?.(`⚠️  ${warning}`);
      // Surfaced beside the other warnings, and left in the file as well: the
      // question belongs next to the scenario it is about, where whoever reads
      // that scenario later will meet it.
      for (const question of extractGeneratedQuestions(content)) {
        opts.log?.(
          `❓ Dòng ${question.line}: ${question.prompt}`
          + (question.scenario ? ` (scenario "${question.scenario}")` : ''),
        );
      }
      return { content, spec, repaired, pendingElements: [...pending.values()] };
    }

    // Say what is actually wrong, every round. Without this the log recorded
    // only that a repair was attempted, and the reason — the one thing needed
    // to fix the source document or the vocabulary — was never written down.
    opts.log?.(
      `Bản testcase còn ${problems.length} lỗi kỹ thuật:` +
        problems.slice(0, 8).map((problem) => `\n  · ${problem}`).join('') +
        (problems.length > 8 ? `\n  · … và ${problems.length - 8} lỗi nữa` : ''),
    );

    if (attempt >= maxRepairs || !canRepair) {
      await opts.onFailure?.({ content, problems });
      const shown = problems.slice(0, 3).map((problem) => `• ${problem}`).join('\n');
      throw new Error(
        'AI chưa chuẩn bị được bản testcase có thể chạy sau các vòng tự sửa.\n' +
          `Lỗi còn lại (${problems.length}):\n${shown}` +
          (problems.length > 3 ? `\n• … và ${problems.length - 3} lỗi nữa` : '') +
          '\nBản lỗi không được ghi vào danh sách duyệt; xem log để biết chi tiết.',
      );
    }

    opts.log?.(`AI đang tự sửa lỗi kỹ thuật của bản testcase (lần ${attempt + 1}/${maxRepairs})…`);
    const protectedDraft = protectSensitiveInputValues(content);
    content = restoreSensitiveInputValues(stripFeature(await repair({
      model: opts.model,
      maxTokens: 12_000,
      temperature: 0,
      system: [
        'Bạn là compiler sửa Gherkin TestPilot trước khi đưa cho người dùng nghiệp vụ review.',
        'Chỉ sửa cú pháp, wording và element reference gây lỗi compile/binding.',
        'Giữ nguyên toàn bộ yêu cầu, scenario, expected result, tag, dữ liệu và credential placeholder.',
        'Không thêm/xoá coverage, không đổi ý nghĩa nghiệp vụ, không tự duyệt testcase.',
        'Không sinh CSS, XPath, testId, code, toạ độ hay chi tiết DOM/native.',
        'Giữ nguyên mọi marker {{TESTPILOT_LOCAL_SECRET_*}}; đó là dữ liệu bí mật đã được che cục bộ.',
        'Element mới được phép giữ bằng label nghiệp vụ trong dấu ngoặc kép; runtime sẽ tìm locator.',
        'Chỉ trả về toàn bộ file .feature đã sửa, bắt đầu bằng Feature: hoặc tag cấp Feature.',
        'Controlled vocabulary hợp lệ:',
        vocabularyDoc(),
      ].join('\n'),
      user: [
        '<compiler_problems>',
        ...problems.map((problem) => `- ${problem}`),
        '</compiler_problems>',
        '<known_elements>',
        ...Object.values(registry.raw.elements).map((element) =>
          `- ${element.id} — ${JSON.stringify(element.label)} — screen=${element.screen}`,
        ),
        '</known_elements>',
        '<feature>',
        protectedDraft.content,
        '</feature>',
      ].join('\n'),
    })), protectedDraft.values);
    repaired = true;
  }

  throw new Error('AI chưa chuẩn bị được bản testcase có thể chạy.');
}

function stripFeature(value: string): string {
  return value.trim().replace(/^```(?:gherkin)?\s*/iu, '').replace(/\s*```$/u, '').trim();
}

function protectSensitiveInputValues(content: string): {
  content: string;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  const lines = content.split('\n').map((line) => {
    if (!/(?:password|mật\s*khẩu|secret|token|api[_ -]?key)/iu.test(line)) return line;
    return line.replace(
      /(I\s+(?:enter|type)\s+)"([^"]*)"((?:\s+(?:in|into)\s+).*)/iu,
      (_whole, before: string, value: string, after: string) => {
        const marker = `{{TESTPILOT_LOCAL_SECRET_${values.size + 1}}}`;
        values.set(marker, value);
        return `${before}"${marker}"${after}`;
      },
    );
  });
  return { content: lines.join('\n'), values };
}

function restoreSensitiveInputValues(content: string, values: Map<string, string>): string {
  let restored = content;
  for (const [marker, value] of values) restored = restored.split(marker).join(value);
  return restored;
}

/** Do not expose registry ids, paths or parser internals in the business UI. */
function safeCompilerMessage(error: unknown): string {
  const message = (error as Error).message.replace(/\s+/g, ' ').trim();
  return message
    .replace(/\/[^ ]+\.feature/gu, 'feature')
    .replace(/\b(?:css|xpath|testId|resourceId)=[^ ]+/giu, '[locator]')
    .slice(0, 600);
}
