import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { matchesVocabulary } from '../steps/normalizer.js';

export type LearnedActionKind = 'alias' | 'macro' | 'primitive';
export type LearnedActionStatus = 'proposed' | 'approved' | 'rejected';

export interface LearnedActionParameter {
  name: string;
  example: string;
}

export interface LearnedActionDef {
  id: string;
  label: string;
  kind: LearnedActionKind;
  status: LearnedActionStatus;
  phraseTemplate: string;
  parameters: LearnedActionParameter[];
  expansion: string[];
  postcondition?: string;
  reason?: string;
  sourceExample: string;
  createdAt: string;
  reviewedAt?: string;
}

interface ActionRegistryData {
  version: 1;
  actions: LearnedActionDef[];
}

export interface ActionExpansion {
  action: LearnedActionDef;
  steps: string[];
}

/**
 * Human-reviewed macro registry for natural-language steps.
 *
 * It intentionally stores data, not JavaScript. An approved action may only
 * expand to the controlled vocabulary, so a model can never inject arbitrary
 * browser/device code into a test run.
 */
export class ActionRegistry {
  private constructor(
    private readonly file: string,
    private data: ActionRegistryData,
  ) {}

  static async load(file: string): Promise<ActionRegistry> {
    if (!existsSync(file)) return new ActionRegistry(file, { version: 1, actions: [] });
    const parsed = JSON.parse(await readFile(file, 'utf8')) as ActionRegistryData;
    return new ActionRegistry(file, {
      version: 1,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    });
  }

  list(): LearnedActionDef[] {
    return [...this.data.actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  propose(input: Omit<LearnedActionDef, 'id' | 'status' | 'createdAt'>): LearnedActionDef {
    const normalizedTemplate = input.phraseTemplate.trim();
    const existing = this.data.actions.find(
      (action) => action.phraseTemplate.toLocaleLowerCase() === normalizedTemplate.toLocaleLowerCase(),
    );
    if (existing) {
      // A model may refine a pending proposal, but it must never overwrite a
      // human approval/rejection on a later normalization request.
      if (existing.status !== 'proposed') return existing;
      existing.expansion = input.expansion;
      existing.parameters = input.parameters;
      existing.postcondition = input.postcondition;
      existing.reason = input.reason;
      existing.sourceExample = input.sourceExample;
      return existing;
    }
    const action: LearnedActionDef = {
      ...input,
      id: `action-${Date.now().toString(36)}-${slug(input.label).slice(0, 32)}`,
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };
    this.data.actions.push(action);
    return action;
  }

  review(id: string, decision: 'approve' | 'reject'): LearnedActionDef {
    const action = this.data.actions.find((item) => item.id === id);
    if (!action) throw new Error('Không tìm thấy action được đề xuất.');
    if (decision === 'approve') {
      const error = validateExecutableAction(action);
      if (error) throw new Error(error);
      action.status = 'approved';
    } else {
      action.status = 'rejected';
    }
    action.reviewedAt = new Date().toISOString();
    return action;
  }

  /** Match one human step against approved templates and expand it locally. */
  expand(step: string): ActionExpansion | undefined {
    for (const action of this.data.actions) {
      if (action.status !== 'approved') continue;
      const values = matchTemplate(action.phraseTemplate, step, action.parameters.map((p) => p.name));
      if (!values) continue;
      return {
        action,
        steps: [
          ...action.expansion.map((line) => interpolate(line, values)),
          ...(action.postcondition && !action.expansion.includes(action.postcondition)
            ? [interpolate(action.postcondition, values)]
            : []),
        ],
      };
    }
    return undefined;
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
  }
}

export function validateExecutableAction(action: LearnedActionDef): string | undefined {
  if (action.kind === 'primitive') {
    return 'Action này cần capability mới trong driver nên chưa thể duyệt để chạy.';
  }
  if (action.expansion.length === 0) return 'Action chưa có kế hoạch thực thi.';
  const names = action.parameters.map((parameter) => parameter.name);
  if (new Set(names).size !== names.length) return 'Tên tham số action bị trùng.';
  if (!matchTemplate(action.phraseTemplate, action.sourceExample, names)) {
    return 'Phrase template không khớp câu mẫu nên action chưa thể tái sử dụng chính xác.';
  }
  const sample = Object.fromEntries(action.parameters.map((p) => [p.name, p.example]));
  for (const raw of action.expansion) {
    const expanded = interpolate(raw, sample);
    if (/\{\{[a-zA-Z][\w]*\}\}/.test(expanded)) {
      return `Bước mở rộng còn tham số chưa khai báo: ${expanded}`;
    }
    if (!matchesVocabulary(expanded)) {
      return `Bước mở rộng chưa thuộc vocabulary an toàn: ${expanded}`;
    }
  }
  if (!action.postcondition) return 'Action cần một postcondition để xác minh kết quả.';
  const postcondition = interpolate(action.postcondition, sample);
  if (/\{\{[a-zA-Z][\w]*\}\}/.test(postcondition)) {
    return `Postcondition còn tham số chưa khai báo: ${postcondition}`;
  }
  if (!matchesVocabulary(postcondition)) {
    return `Postcondition chưa thuộc vocabulary an toàn: ${postcondition}`;
  }
  return undefined;
}

function matchTemplate(template: string, step: string, names: string[]): Record<string, string> | undefined {
  let source = '';
  let cursor = 0;
  const found: string[] = [];
  const token = /\{\{([a-zA-Z][\w]*)\}\}/g;
  for (const match of template.matchAll(token)) {
    source += escapeRegex(template.slice(cursor, match.index));
    source += '(.+?)';
    found.push(match[1]!);
    cursor = (match.index ?? 0) + match[0].length;
  }
  source += escapeRegex(template.slice(cursor));
  const result = step.trim().match(new RegExp(`^${source}$`, 'iu'));
  if (!result) return undefined;
  const values: Record<string, string> = {};
  found.forEach((name, index) => { values[name] = result[index + 1] ?? ''; });
  for (const name of names) if (!(name in values)) return undefined;
  return values;
}

function interpolate(value: string, values: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z][\w]*)\}\}/g, (_, name: string) => values[name] ?? `{{${name}}}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
