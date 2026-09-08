import Anthropic from '@anthropic-ai/sdk';
import type { ElementDef, LocatorCandidate, ScreenDef } from '../core/types.js';
import type { SourceDoc } from '../ingest/types.js';
import { completeJson, completeText, providerOf } from '../llm/client.js';
import { firstJsonObject } from '../llm/json.js';
import { coveragePromptBlock, type CoverageRequirement } from './coverage.js';
import {
  FEATURE_SYSTEM,
  MODEL_SYSTEM,
  documentContext,
  featureTask,
  modelTask,
  type ExtraContext,
} from './prompt.js';

const DEFAULT_MODEL = 'claude-opus-5';

export interface GenOptions {
  client?: Anthropic;
  model?: string;
  /** low | medium | high | xhigh | max. Spec generation rewards thoroughness. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /**
   * Note / accounts / target feature from the Scenario Studio form. These go in
   * the user message, not the system blocks, so the cached document prefix is
   * identical across both passes and across runs that only change the note.
   */
  extra?: ExtraContext;
  /** Traceable P0/P1 contract extracted before Gherkin generation. */
  coverage?: CoverageRequirement[];
  /**
   * Screens and elements the registry already holds, so the model reuses their
   * names instead of coining a synonym that reconciliation cannot match back.
   */
  known?: { screens: ScreenDef[]; elements: ElementDef[] };
}

export interface GeneratedModel {
  screens: ScreenDef[];
  elements: ElementDef[];
}

const LOCATOR_ITEM = {
  type: 'object',
  properties: {
    strategy: {
      type: 'string',
      enum: ['testId', 'role', 'label', 'placeholder', 'css', 'xpath', 'predicate'],
    },
    value: { type: 'string' },
    name: { type: 'string', description: 'Accessible name that disambiguates; "" if none.' },
    weight: { type: 'number', description: '0..1, higher means more stable.' },
  },
  required: ['strategy', 'value', 'name', 'weight'],
  additionalProperties: false,
} as const;

const MODEL_SCHEMA = {
  type: 'object',
  properties: {
    screens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id', 'title', 'description'],
        additionalProperties: false,
      },
    },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'screen.elementName' },
          label: { type: 'string' },
          screen: { type: 'string' },
          candidates: {
            type: 'object',
            properties: {
              web: { type: 'array', items: LOCATOR_ITEM },
              android: { type: 'array', items: LOCATOR_ITEM },
              ios: { type: 'array', items: LOCATOR_ITEM },
            },
            required: ['web', 'android', 'ios'],
            additionalProperties: false,
          },
        },
        required: ['id', 'label', 'screen', 'candidates'],
        additionalProperties: false,
      },
    },
  },
  required: ['screens', 'elements'],
  additionalProperties: false,
} as const;

/**
 * The document context is the same for both generation passes and is by far the
 * largest part of the prompt, so it goes FIRST in the system array with the
 * cache breakpoint on it. Caching is a prefix match — putting the pass-specific
 * instructions first would give the two calls different prefixes and the cache
 * would never be read.
 */
function systemBlocks(docs: SourceDoc[], instructions: string) {
  return [
    {
      type: 'text' as const,
      text: documentContext(docs),
      cache_control: { type: 'ephemeral' as const },
    },
    { type: 'text' as const, text: instructions },
  ];
}

function clientOf(opts: GenOptions): Anthropic {
  return opts.client ?? new Anthropic();
}

type StreamParams = Parameters<Anthropic['messages']['stream']>[0];

/**
 * The pinned SDK typings predate `thinking: {type:'adaptive'}` and
 * `output_config`. Both are correct on the wire, so the request is built as a
 * plain object and cast exactly once, here, rather than at every call site.
 * Delete this shim when the SDK types catch up.
 */
function params(o: Record<string, unknown>): StreamParams {
  return o as unknown as StreamParams;
}

export async function generateModel(
  docs: SourceDoc[],
  opts: GenOptions = {},
): Promise<GeneratedModel> {
  const model = opts.model ?? DEFAULT_MODEL;
  let raw: string;
  if (!opts.client && providerOf(model) === 'deepseek') {
    raw = await completeJson({
      model,
      maxTokens: opts.maxTokens ?? 8_000,
      system: [
        documentContext(docs),
        MODEL_SYSTEM,
        'Return one JSON object matching this JSON Schema exactly:',
        JSON.stringify(MODEL_SCHEMA),
      ].join('\n\n'),
      user: modelTask(opts.extra ?? {}, opts.known),
      temperature: 0,
    });
    console.log(`[genspec:model] provider=deepseek model=${model}`);
  } else {
    const client = clientOf(opts);
    const stream = client.messages.stream(
      params({
        model,
        max_tokens: opts.maxTokens ?? 32_000,
        thinking: { type: 'adaptive' },
        system: systemBlocks(docs, MODEL_SYSTEM),
        messages: [{ role: 'user', content: modelTask(opts.extra ?? {}, opts.known) }],
        output_config: {
          effort: opts.effort ?? 'high',
          format: { type: 'json_schema', schema: MODEL_SCHEMA },
        },
      }),
    );

    const message = await stream.finalMessage();
    logUsage('model', message);
    raw = firstText(message);
  }

  const parsed = JSON.parse(firstJsonObject(raw)) as unknown;
  const source = docs[0]
    ? ({ kind: docs[0].kind, ref: docs[0].ref } as const)
    : undefined;
  return readModel(parsed, source);
}

/**
 * Read the model's answer as untrusted input.
 *
 * This stage is the most expensive thing a user waits for — the document is
 * fetched, read and reasoned over — and it used to end on the first field it
 * disliked. One element carrying `strategy: "text"` destroyed an entire run: no
 * registry, no scenarios, nothing to review, after minutes of waiting. The cost
 * of the failure had no relationship to the size of the defect.
 *
 * So nothing here throws on a bad part. Anything unusable is dropped with a
 * warning naming what and why, and the rest is kept. The one genuine failure is
 * an answer with nothing usable in it at all, which is worth reporting because
 * there is no partial result to salvage.
 */
export function readModel(
  parsed: unknown,
  source?: { kind: 'confluence' | 'figma' | 'manual'; ref: string },
): GeneratedModel {
  const root = isRecord(parsed) ? parsed : {};
  const rawScreens = Array.isArray(root.screens) ? root.screens : [];
  const rawElements = Array.isArray(root.elements) ? root.elements : [];
  if (!Array.isArray(root.screens)) console.warn('[gen] model không trả về "screens".');
  if (!Array.isArray(root.elements)) console.warn('[gen] model không trả về "elements".');

  const screens: ScreenDef[] = [];
  for (const item of rawScreens) {
    if (!isRecord(item) || !text(item.id) || !text(item.title)) {
      console.warn(`[gen] bỏ qua một screen thiếu id hoặc title: ${preview(item)}`);
      continue;
    }
    screens.push({
      id: text(item.id)!,
      title: text(item.title)!,
      ...(text(item.description) ? { description: text(item.description)! } : {}),
      ...(source ? { source } : {}),
    });
  }

  const elements: ElementDef[] = [];
  for (const item of rawElements) {
    if (!isRecord(item) || !text(item.id) || !text(item.label) || !text(item.screen)) {
      // Kept out rather than repaired: an element without an id cannot be
      // referenced, and one without a screen cannot be disambiguated. Inventing
      // either would put a name into the registry that nothing ever agreed on.
      console.warn(`[gen] bỏ qua một element thiếu id/label/screen: ${preview(item)}`);
      continue;
    }
    const id = text(item.id)!;
    elements.push({
      id,
      label: text(item.label)!,
      screen: text(item.screen)!,
      candidates: readCandidates(item.candidates, id),
    });
  }

  if (screens.length === 0 && elements.length === 0) {
    // Not an error, and not this function's call to make. An empty answer is a
    // legitimate outcome when the document describes a flow whose controls the
    // registry already holds — the pipeline loads those before generating and
    // reports them as "vốn từ sẵn có". Whether the run can proceed is decided
    // where the requirement actually exists: binding, which fails by naming the
    // exact label it could not find. Deciding it here, from the wrong side of
    // the pipeline, would kill runs that had everything they needed.
    console.warn(
      '[gen] model không mô tả screen hay element mới nào — '
      + 'kịch bản sẽ phải dựa hoàn toàn vào registry hiện có.',
    );
  }
  return { screens, elements };
}

/** Only the platforms that exist; anything else the model invented is dropped. */
function readCandidates(raw: unknown, elementId: string): ElementDef['candidates'] {
  const out: ElementDef['candidates'] = {};
  if (!isRecord(raw)) {
    console.warn(`[gen] "${elementId}" không có candidates — để runtime discovery xử lý.`);
    return out;
  }
  for (const platform of ['web', 'android', 'ios'] as const) {
    const list = raw[platform];
    if (!Array.isArray(list)) continue;
    out[platform] = list
      .filter(isRecord)
      .map((item) => toCandidate(item, elementId))
      .filter((item): item is LocatorCandidate => item !== undefined)
      .sort((a, b) => b.weight - a.weight);
  }
  for (const key of Object.keys(raw)) {
    if (!['web', 'android', 'ios'].includes(key)) {
      console.warn(`[gen] "${elementId}": bỏ qua nền tảng không tồn tại "${key}".`);
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, or undefined — the model writes `""` for "no value". */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Enough of a rejected item to recognise it, without flooding the log. */
function preview(value: unknown): string {
  return JSON.stringify(value)?.slice(0, 120) ?? String(value);
}

export async function generateFeature(
  docs: SourceDoc[],
  elements: ElementDef[],
  opts: GenOptions = {},
): Promise<string> {
  const model = opts.model ?? DEFAULT_MODEL;
  const summary = elements.map((e) => `- ${e.id} — "${e.label}" (${e.screen})`).join('\n');

  if (!opts.client && providerOf(model) === 'deepseek') {
    const raw = await completeText({
      model,
      maxTokens: opts.maxTokens ?? 8_000,
      system: `${documentContext(docs)}\n\n${FEATURE_SYSTEM}`,
      user: featureTask(summary, opts.extra ?? {}, opts.known) + coveragePromptBlock(opts.coverage ?? []),
      temperature: 0,
    });
    console.log(`[genspec:feature] provider=deepseek model=${model}`);
    return stripFences(raw.trim());
  }

  const client = clientOf(opts);

  const stream = client.messages.stream(
    params({
      model,
      max_tokens: opts.maxTokens ?? 32_000,
      thinking: { type: 'adaptive' },
      system: systemBlocks(docs, FEATURE_SYSTEM),
      messages: [{
        role: 'user',
        content: featureTask(summary, opts.extra ?? {}, opts.known) + coveragePromptBlock(opts.coverage ?? []),
      }],
      output_config: { effort: opts.effort ?? 'high' },
    }),
  );

  const message = await stream.finalMessage();
  logUsage('feature', message);
  return stripFences(firstText(message));
}

const STRATEGIES = new Set<LocatorCandidate['strategy']>([
  'testId',
  'role',
  'label',
  'placeholder',
  'css',
  'xpath',
  'predicate',
]);

/**
 * Names the model reaches for that mean a strategy we already have.
 *
 * The schema carries the enum, but the response is parsed out of text rather
 * than enforced by the API, so the enum is guidance and not a guarantee. These
 * are not guesses at intent: "text" and "label" both mean match on the visible
 * string, and the testId spellings differ only in punctuation.
 */
const STRATEGY_SYNONYMS: Record<string, LocatorCandidate['strategy']> = {
  text: 'label',
  testid: 'testId',
  'test-id': 'testId',
  'data-testid': 'testId',
  accessibilityid: 'testId',
  'accessibility-id': 'testId',
};

export function normaliseStrategy(raw: string): LocatorCandidate['strategy'] | undefined {
  const trimmed = raw.trim();
  if (STRATEGIES.has(trimmed as LocatorCandidate['strategy'])) {
    return trimmed as LocatorCandidate['strategy'];
  }
  const lower = trimmed.toLowerCase();
  const exact = [...STRATEGIES].find((s) => s.toLowerCase() === lower);
  return exact ?? STRATEGY_SYNONYMS[lower];
}

/**
 * One unusable candidate must not cost the whole generation.
 *
 * This used to throw, which meant a single bad strategy string on a single
 * element ended a workflow at its first stage and produced nothing — no
 * registry, no scenarios, nothing to review. An element short one candidate
 * still works: runtime discovery locates it, and the other candidates remain.
 * So the bad one is dropped, loudly, and the run continues.
 */
export function toCandidate(
  c: Record<string, unknown>,
  elementId: string,
): LocatorCandidate | undefined {
  const raw = String(c.strategy);
  const strategy = normaliseStrategy(raw);
  if (!strategy) {
    console.warn(
      `[gen] bỏ qua locator của "${elementId}": chiến lược "${raw}" không tồn tại. `
      + `Hợp lệ: ${[...STRATEGIES].join(', ')}.`,
    );
    return undefined;
  }
  if (strategy !== raw) {
    console.warn(`[gen] "${elementId}": đổi chiến lược "${raw}" thành "${strategy}".`);
  }
  const weight = Number(c.weight);
  return {
    strategy,
    value: String(c.value),
    ...(c.name ? { name: String(c.name) } : {}),
    weight: Number.isFinite(weight) ? weight : 0.5,
    origin: 'llm',
  };
}

function firstText(message: Anthropic.Message): string {
  const block = message.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error(
      `The model returned no text (stop_reason=${message.stop_reason}). ` +
        `If this is "refusal", the source document tripped a safety classifier.`,
    );
  }
  return block.text.trim();
}

/** Cache hits are the difference between one cheap run and one expensive one. */
function logUsage(pass: string, message: Anthropic.Message): void {
  const u = message.usage;
  console.log(
    `[genspec:${pass}] in=${u.input_tokens} out=${u.output_tokens} ` +
      `cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`,
  );
}

function stripFences(s: string): string {
  return s.replace(/^```(?:gherkin|cucumber)?\n/, '').replace(/\n```$/, '');
}


