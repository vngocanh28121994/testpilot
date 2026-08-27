/**
 * One place that knows which model vendor a request goes to.
 *
 * The step normalizer is the only feature that talks to a model, and it asks
 * for the same thing from either vendor: a system prompt, a user payload, and
 * JSON back. DeepSeek speaks the OpenAI wire format, so it needs no SDK — a
 * plain fetch keeps the dependency list unchanged.
 *
 * Which vendor runs is decided by the model id, so pinning "deepseek-chat" in
 * the config is all it takes to switch. "auto" follows whichever key exists,
 * preferring DeepSeek when both are present because that is the key this
 * project was told to spend.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_LLM_MODEL } from '../config.js';

export type LlmProvider = 'anthropic' | 'deepseek';

const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const REQUEST_TIMEOUT_MS = 90_000;

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', display_name: 'DeepSeek Chat' },
  { id: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner' },
];

const KEY_ENV: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

export function providerOf(model: string): LlmProvider {
  return model.trim().toLowerCase().startsWith('deepseek') ? 'deepseek' : 'anthropic';
}

export function hasKey(provider: LlmProvider): boolean {
  return Boolean(process.env[KEY_ENV[provider]]);
}

/** True when at least one vendor is reachable, whatever the config pins. */
export function llmAvailable(): boolean {
  return hasKey('deepseek') || hasKey('anthropic');
}

/**
 * Turns the configured model into one that can actually run. A pinned model is
 * respected only while its key exists; otherwise this falls back rather than
 * failing a normalize request with an auth error the user cannot act on.
 */
export function pickModel(configured: string): string {
  const wanted = !configured || configured === 'auto' ? '' : configured.trim();
  if (wanted && hasKey(providerOf(wanted))) return wanted;
  if (hasKey('deepseek')) return DEFAULT_DEEPSEEK_MODEL;
  if (hasKey('anthropic')) return DEFAULT_LLM_MODEL;
  return wanted || DEFAULT_LLM_MODEL;
}

/** Names the key a caller is missing, for an error the reader can act on. */
export function missingKeyHint(): string {
  return `Server chưa có ${KEY_ENV.deepseek} hoặc ${KEY_ENV.anthropic}.`;
}

/**
 * Ask the model for JSON. The caller parses — vendors disagree about how
 * reliably they honour a JSON mode, so neither answer is trusted here.
 */
export async function completeJson(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /**
   * 0 for work that must repeat. Element selection is a lookup, not writing:
   * asked the same question about the same screen it has to give the same
   * answer, or a test suite stops meaning anything. Left undefined for
   * generation, where the vendor default is the better choice.
   */
  temperature?: number;
}): Promise<string> {
  return providerOf(opts.model) === 'deepseek'
    ? deepseekCompletion(opts, true)
    : anthropicCompletion(opts);
}

/** Free-form completion used by Gherkin generation. */
export async function completeText(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  return providerOf(opts.model) === 'deepseek'
    ? deepseekCompletion(opts, false)
    : anthropicCompletion(opts);
}

async function anthropicCompletion(opts: {
  model: string; system: string; user: string; maxTokens: number; temperature?: number;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    messages: [{ role: 'user', content: opts.user }],
  });
  return response.content.find((part) => part.type === 'text')?.text ?? '';
}

async function deepseekCompletion(
  opts: { model: string; system: string; user: string; maxTokens: number; temperature?: number },
  json: boolean,
): Promise<string> {
  const key = process.env[KEY_ENV.deepseek];
  if (!key) throw new Error(`${KEY_ENV.deepseek} chưa được set.`);

  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      stream: false,
      // JSON mode is only used by structured callers. Gherkin generation must
      // remain plain text or the provider will wrap it in an artificial object.
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`DeepSeek ${response.status}: ${detail || response.statusText}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content ?? '';
}

/** The model list offered in the UI: live from Anthropic, static from DeepSeek. */
export async function listModels(): Promise<{
  models: Array<{ id: string; display_name?: string }>;
  live: boolean;
  reason?: string;
}> {
  const deepseek = hasKey('deepseek') ? DEEPSEEK_MODELS : [];
  if (!hasKey('anthropic')) {
    return deepseek.length > 0
      ? { models: deepseek, live: true }
      : { models: [], live: false, reason: missingKeyHint() };
  }
  try {
    const page = await new Anthropic().models.list({ limit: 30 });
    const list = page.data.map((m) => ({ id: m.id, display_name: m.display_name }));
    return { models: [...deepseek, ...list], live: list.length > 0 };
  } catch (err) {
    return { models: deepseek, live: false, reason: (err as Error).message };
  }
}
