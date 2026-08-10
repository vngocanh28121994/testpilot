import Anthropic from '@anthropic-ai/sdk';
import type { ElementDef, LocatorCandidate, ScreenDef } from '../core/types.js';
import type { SourceDoc } from '../ingest/types.js';
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
  const client = clientOf(opts);
  const stream = client.messages.stream(
    params({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 32_000,
      thinking: { type: 'adaptive' },
      system: systemBlocks(docs, MODEL_SYSTEM),
      messages: [{ role: 'user', content: modelTask(opts.extra ?? {}) }],
      output_config: {
        effort: opts.effort ?? 'high',
        format: { type: 'json_schema', schema: MODEL_SCHEMA },
      },
    }),
  );

  const message = await stream.finalMessage();
  logUsage('model', message);
  const raw = firstText(message);
  const parsed = JSON.parse(raw) as {
    screens: Array<{ id: string; title: string; description: string }>;
    elements: Array<{
      id: string;
      label: string;
      screen: string;
      candidates: Record<string, Array<Record<string, unknown>>>;
    }>;
  };

  const source = docs[0]
    ? ({ kind: docs[0].kind, ref: docs[0].ref } as const)
    : undefined;

  return {
    screens: parsed.screens.map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.description ? { description: s.description } : {}),
      ...(source ? { source } : {}),
    })),
    elements: parsed.elements.map((e) => ({
      id: e.id,
      label: e.label,
      screen: e.screen,
      candidates: Object.fromEntries(
        Object.entries(e.candidates).map(([platform, list]) => [
          platform,
          list.map(toCandidate).sort((a, b) => b.weight - a.weight),
        ]),
      ) as ElementDef['candidates'],
    })),
  };
}

export async function generateFeature(
  docs: SourceDoc[],
  elements: ElementDef[],
  opts: GenOptions = {},
): Promise<string> {
  const client = clientOf(opts);
  const summary = elements.map((e) => `- ${e.id} — "${e.label}" (${e.screen})`).join('\n');

  const stream = client.messages.stream(
    params({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 32_000,
      thinking: { type: 'adaptive' },
      system: systemBlocks(docs, FEATURE_SYSTEM),
      messages: [{ role: 'user', content: featureTask(summary, opts.extra ?? {}) }],
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

/** The schema constrains the model, but a bad candidate must still fail loudly here. */
function toCandidate(c: Record<string, unknown>): LocatorCandidate {
  const strategy = String(c.strategy) as LocatorCandidate['strategy'];
  if (!STRATEGIES.has(strategy)) {
    throw new Error(`Generated an unknown locator strategy "${c.strategy}".`);
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
