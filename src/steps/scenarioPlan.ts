import { normalizeHumanText } from '../core/text.js';

export type ScenarioPlanStepKind =
  | 'precondition'
  | 'navigation'
  | 'focusRegion'
  | 'action'
  | 'assertion';

export interface ScenarioPlanStep {
  /** Original Gherkin line number. */
  line: number;
  kind: ScenarioPlanStepKind;
  /** Business target copied from the source, never a selector. */
  target?: string;
  /** Business region that narrows this and following actions. */
  scope?: string;
  action?: string;
  expectedResult?: string;
  confidence: number;
  reason: string;
}

export interface ScenarioPlan {
  source: 'ai' | 'deterministic';
  goal: string;
  screen?: string;
  preconditions: string[];
  reusableFlows: string[];
  steps: ScenarioPlanStep[];
  warnings: string[];
}

export interface RawScenarioPlan {
  goal?: unknown;
  screen?: unknown;
  preconditions?: unknown;
  reusableFlows?: unknown;
  steps?: unknown;
  warnings?: unknown;
}

interface SourceStep {
  line: number;
  keyword: string;
  text: string;
}

/** Extract only non-sensitive business wording for the semantic planner. */
export function planningInput(content: string): {
  scenario: string;
  steps: Array<{ line: number; keyword: string; text: string }>;
} {
  const scenario = content.match(/^\s*Scenario(?: Outline)?:\s*(.+)$/imu)?.[1]?.trim() ?? 'Kịch bản';
  return {
    scenario,
    steps: sourceSteps(content).map((step) => ({
      ...step,
      text: isSensitivePlanningStep(step.text)
        ? '[Bước thông tin đăng nhập được giữ cục bộ]'
        : step.text,
    })),
  };
}

/** Safe local plan used when no model key is available or the response is invalid. */
export function deterministicScenarioPlan(content: string): ScenarioPlan {
  const input = planningInput(content);
  const steps: ScenarioPlanStep[] = [];
  const preconditions: string[] = [];
  const reusable = new Set<string>();
  for (const step of sourceSteps(content)) {
    const text = step.text.trim();
    if (/^I am logged in as\s+/iu.test(text) || /^(?:tôi|người dùng)\s+đã đăng nhập/iu.test(text)) {
      preconditions.push('Đã đăng nhập');
      reusable.add('Đăng nhập');
      steps.push(planStep(step.line, 'precondition', 'Đảm bảo trạng thái đăng nhập'));
      continue;
    }
    const feature = text.match(/^I open feature "([^"]+)" from search$/iu)?.[1]
      ?? text.match(/^(?:tôi|người dùng)\s+mở chức năng\s+"?([^"]+)"?$/iu)?.[1];
    if (feature) {
      reusable.add('Mở chức năng từ tìm kiếm');
      steps.push({
        ...planStep(step.line, 'navigation', 'Mở đúng chức năng nghiệp vụ'),
        target: feature,
        action: 'open',
      });
      continue;
    }
    const visible = text.match(/^(?:(?:tôi|người dùng)\s+(?:kiểm tra|xác nhận)\s+)?(.+?)\s+(không\s+)?(?:hiển thị|xuất hiện)$/iu);
    if (visible?.[1]) {
      const target = cleanBusinessPhrase(visible[1]);
      steps.push({
        ...planStep(step.line, 'assertion', 'Kiểm tra kết quả nghiệp vụ quan sát được'),
        target,
        action: visible[2] ? 'assertAbsent' : 'assertVisible',
        expectedResult: text,
      });
      continue;
    }
    const region = text.match(/^I inspect (?:the )?(?:section|region|area) "([^"]+)"$/iu)?.[1]
      ?? text.match(/^(?:tôi|người dùng)\s+(?:kiểm tra|xem xét)\s+(.+)$/iu)?.[1];
    if (region) {
      const target = cleanBusinessPhrase(region);
      steps.push({
        ...planStep(step.line, 'focusRegion', 'Giữ vùng này làm phạm vi cho các bước tiếp theo'),
        target,
        scope: target,
        action: 'inspect',
      });
      continue;
    }
    const assertion = text.match(/^"([^"]+)" is (not )?visible$/iu);
    if (assertion?.[1]) {
      steps.push({
        ...planStep(step.line, 'assertion', 'Kiểm tra trạng thái quan sát được'),
        target: assertion[1],
        action: assertion[2] ? 'assertAbsent' : 'assertVisible',
        expectedResult: text,
      });
      continue;
    }
    const scopedAction = text.match(/^(?:tôi|người dùng)\s+(?:chọn|bấm|nhấn|ấn|click)\s+(.+?)\s+(?:trong|tại|ở)\s+(.+)$/iu);
    if (scopedAction?.[1] && scopedAction[2]) {
      steps.push({
        ...planStep(step.line, 'action', 'Thao tác trong một vùng nghiệp vụ cụ thể'),
        target: cleanBusinessPhrase(scopedAction[1]),
        scope: cleanBusinessPhrase(scopedAction[2]),
        action: 'click',
      });
      continue;
    }
    const target = quotedValues(text).at(-1);
    steps.push({
      ...planStep(step.line, 'action', 'Thao tác nghiệp vụ sẽ được binding ở runtime'),
      ...(target ? { target } : {}),
    });
  }
  return {
    source: 'deterministic',
    goal: input.scenario,
    preconditions,
    reusableFlows: [...reusable],
    steps,
    warnings: [],
  };
}

/**
 * Treat model output as untrusted data. It may classify and connect business
 * phrases, but it cannot introduce selectors, code, secrets or untraceable UI
 * names. Targets/scopes must be present in the original scenario wording.
 */
export function validateScenarioPlan(raw: RawScenarioPlan | undefined, content: string): ScenarioPlan | undefined {
  if (!raw || !Array.isArray(raw.steps)) return undefined;
  const originals = new Map(sourceSteps(content).map((step) => [step.line, step]));
  const kinds = new Set<ScenarioPlanStepKind>([
    'precondition', 'navigation', 'focusRegion', 'action', 'assertion',
  ]);
  const steps: ScenarioPlanStep[] = [];
  for (const item of raw.steps) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const line = Number(value.line);
    const kind = value.kind as ScenarioPlanStepKind;
    const source = originals.get(line);
    if (!source || !kinds.has(kind)) continue;
    const target = safePhrase(value.target);
    const scope = safePhrase(value.scope);
    // Executable/structural steps without a traceable business target carry no
    // useful meaning. Dropping an invalid target but keeping the action would
    // make a malformed model response look accepted in the reviewer.
    if (kind !== 'precondition' && !target) continue;
    if (value.scope !== undefined && value.scope !== null && !scope) continue;
    // A plan may carry context from a prior line, but every *new* business name
    // must still occur somewhere in this scenario. This prevents hallucinated
    // screens/elements from entering executable Gherkin.
    if (target && !phraseOccurs(content, target)) continue;
    if (scope && !phraseOccurs(content, scope)) continue;
    steps.push({
      line,
      kind,
      ...(target ? { target } : {}),
      ...(scope ? { scope } : {}),
      ...(safePhrase(value.action) ? { action: safePhrase(value.action) } : {}),
      ...(safePhrase(value.expectedResult)
        ? { expectedResult: safePhrase(value.expectedResult) }
        : {}),
      confidence: clamp(Number(value.confidence), 0, 1, 0.5),
      reason: safePhrase(value.reason) ?? 'AI phân tích ngữ nghĩa nghiệp vụ',
    });
  }
  if (steps.length === 0) return undefined;
  const fallback = deterministicScenarioPlan(content);
  const acceptedByLine = new Map(steps.map((step) => [step.line, step]));
  const fallbackByLine = new Map(fallback.steps.map((step) => [step.line, step]));
  const mergedSteps = sourceSteps(content)
    .map((source) => acceptedByLine.get(source.line) ?? fallbackByLine.get(source.line))
    .filter((step): step is ScenarioPlanStep => Boolean(step));
  return {
    source: 'ai',
    goal: safePhrase(raw.goal) ?? fallback.goal,
    ...(safePhrase(raw.screen) && phraseOccurs(content, safePhrase(raw.screen)!)
      ? { screen: safePhrase(raw.screen) }
      : {}),
    preconditions: [...new Set([
      ...fallback.preconditions,
      ...traceableList(raw.preconditions, content),
    ])],
    reusableFlows: [...new Set([
      ...fallback.reusableFlows,
      ...traceableList(raw.reusableFlows, content),
    ])],
    steps: mergedSteps,
    warnings: stringList(raw.warnings),
  };
}

/**
 * Compile only high-confidence structural meaning. All ordinary actions still
 * pass through the controlled normalizer and registry; the plan cannot inject
 * executable code.
 */
export function applyScenarioPlan(content: string, plan: ScenarioPlan): {
  content: string;
  changes: Array<{ line: number; from: string; to: string; reason: string }>;
} {
  if (plan.source !== 'ai') return { content, changes: [] };
  const byLine = new Map(plan.steps.map((step) => [step.line, step]));
  const changes: Array<{ line: number; from: string; to: string; reason: string }> = [];
  const output: string[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const parsed = line.match(/^(\s*)(Given|When|Then|And|But)\s+(.+)$/i);
    const step = byLine.get(lineNo);
    if (!parsed || !step || step.confidence < 0.8) {
      output.push(line);
      return;
    }
    const indent = parsed[1] ?? '';
    const keyword = parsed[2] ?? 'And';
    const original = parsed[3]!.trim();
    if (step.kind === 'focusRegion' && step.target) {
      const canonical = `I inspect section "${step.target}"`;
      output.push(`${indent}${keyword} ${canonical}`);
      if (canonical !== original) changes.push({
        line: lineNo,
        from: original,
        to: canonical,
        reason: step.reason,
      });
      return;
    }
    // A single ticket sentence may carry both scope and action. Preserve both
    // as two explicit intents rather than flattening away the region.
    if (step.kind === 'action' && step.scope && step.target && phraseOccurs(original, step.scope)) {
      const region = `I inspect section "${step.scope}"`;
      const action = `I click "${step.target}"`;
      output.push(`${indent}${keyword} ${region}`, `${indent}And ${action}`);
      changes.push({
        line: lineNo,
        from: original,
        to: `${region} → ${action}`,
        reason: step.reason,
      });
      return;
    }
    output.push(line);
  });
  return { content: output.join('\n'), changes };
}

function sourceSteps(content: string): SourceStep[] {
  const result: SourceStep[] = [];
  content.replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
    const match = line.match(/^\s*(Given|When|Then|And|But)\s+(.+)$/i);
    if (match?.[1] && match[2]) result.push({ line: index + 1, keyword: match[1], text: match[2].trim() });
  });
  return result;
}

function planStep(line: number, kind: ScenarioPlanStepKind, reason: string): ScenarioPlanStep {
  return { line, kind, confidence: 1, reason };
}

function isSensitivePlanningStep(text: string): boolean {
  return /password|mật\s*khẩu|secret|token|api[_ -]?key|\{\{account\.[^.]+\.password\}\}/iu.test(text);
}

function quotedValues(value: string): string[] {
  return [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]!).filter(Boolean);
}

function safePhrase(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 240 || /(?:xpath|css=|javascript:|<script|\bfunction\b)/iu.test(clean)) {
    return undefined;
  }
  return clean;
}

function cleanBusinessPhrase(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safePhrase).filter((item): item is string => Boolean(item)).slice(0, 20);
}

function traceableList(value: unknown, content: string): string[] {
  return stringList(value).filter((item) => phraseOccurs(content, item));
}

function phraseOccurs(source: string, phrase: string): boolean {
  return normalizeHumanText(source).includes(normalizeHumanText(phrase));
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
