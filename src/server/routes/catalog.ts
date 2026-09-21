/**
 * Những route chỉ đọc và không có trạng thái: từ vựng, macro hành động, model.
 *
 * Chuyển trước tiên vì chúng không ghi gì cả — nếu việc tách có làm hỏng thứ
 * gì thì hỏng ở đây là thứ rẻ nhất để phát hiện và sửa. Nội dung handler giữ
 * nguyên từng dòng so với bản trong `switch` cũ.
 */
import { Registry } from '../../core/registry.js';
import { ActionRegistry } from '../../actions/ActionRegistry.js';
import { loadConfig } from '../../config.js';
import { listModels, llmAvailable, missingKeyHint, pickModel } from '../../llm/client.js';
import { STEP_RULES } from '../../steps/vocabulary.js';
import { json } from '../http.js';
import type { RouteTable } from './types.js';

/**
 * Shown when the Anthropic Models API cannot be reached despite a key being
 * present — offline, a restricted org, a transient 5xx.
 *
 * Deliberately NOT shown when there is no key at all. A server with no key can
 * run none of these, and offering them tells someone whose config pins a
 * DeepSeek model that their model has disappeared and four Anthropic ones have
 * arrived — a list that is wrong in both directions. Silence plus the reason is
 * the honest answer there.
 */
export const FALLBACK_MODELS = [
  { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
];

export async function models() {
  const result = await listModels();
  // The browser shows what "auto" resolves to, which depends on the keys this
  // server has, not on a constant the page could hardcode.
  const auto = pickModel('auto');
  if (result.models.length > 0) return { ...result, auto };
  // A key exists but the list did not arrive: guessing is better than nothing,
  // because those models are the ones the key can actually run.
  if (llmAvailable()) return { ...result, auto, models: FALLBACK_MODELS };
  return { ...result, auto, reason: result.reason ?? missingKeyHint() };
}

export const catalogRoutes: RouteTable = {
  'GET /api/vocabulary': async (_req, res, _url, ctx) => {
    const cfg = await loadConfig(ctx.configFile);
    const [registryData, actions] = await Promise.all([
      ctx.repos.registry.read(),
      ActionRegistry.load(cfg.paths.actionsDb),
    ]);
    const registry = Registry.fromData(registryData.data);
    return json(res, 200, {
      forms: STEP_RULES.map((rule) => ({
        id: rule.id,
        group: rule.group,
        doc: rule.doc,
        hint: rule.hint,
      })),
      actions: actions
        .list()
        .filter((action) => action.status === 'approved')
        .map((action) => ({
          id: action.id,
          label: action.label,
          phraseTemplate: action.phraseTemplate,
          parameters: action.parameters,
        })),
      elements: Object.values(registry.raw.elements)
        .map((el) => ({ id: el.id, label: el.label, screen: el.screen }))
        .sort((a, b) => a.screen.localeCompare(b.screen) || a.label.localeCompare(b.label)),
    });
  },

  'GET /api/actions': async (_req, res, _url, ctx) => {
    const cfg = await loadConfig(ctx.configFile);
    const actions = await ActionRegistry.load(cfg.paths.actionsDb);
    return json(res, 200, { actions: actions.list() });
  },

  'GET /api/models': async (_req, res) => json(res, 200, await models()),
};
