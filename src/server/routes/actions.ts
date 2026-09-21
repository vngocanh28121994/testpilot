/**
 * Duyệt macro hành động do AI đề xuất.
 *
 * Tách khỏi `catalog.ts` vì đó là nhóm thuần đọc: một endpoint ghi nằm lẫn
 * trong đó sẽ mất đi cái tính chất khiến nhóm ấy an toàn.
 */
import { ActionRegistry } from '../../actions/ActionRegistry.js';
import { loadConfig } from '../../config.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

export const actionsRoutes: RouteTable = {
  'POST /api/actions/review': async (req, res, url, ctx) => {
    const body = await readJson<{ id: string; decision: 'approve' | 'reject' }>(req);
    if (!body.id || !['approve', 'reject'].includes(body.decision)) {
      return json(res, 400, { error: 'Quyết định action không hợp lệ.' });
    }
    const cfg = await loadConfig(ctx.configFile);
    const actions = await ActionRegistry.load(cfg.paths.actionsDb);
    const action = actions.review(body.id, body.decision);
    await actions.save();
    return json(res, 200, { action, actions: actions.list() });
  },
};
