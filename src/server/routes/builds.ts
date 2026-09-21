/**
 * Nguồn app cho một môi trường: dùng bản đã cài trên máy, hay bản build đã tải lên.
 *
 * FARM-ROUTE-MAP.md xếp route này vào nhóm RUNNER vì tên nó nghe như đi đọc
 * thiết bị. Đọc kỹ thì không: nó chỉ ghi một cờ vào config. Sửa lại bản đồ
 * thay vì đẩy một route thuần cấu hình sang runner — phân loại sai theo hướng
 * đó sẽ kéo cả `saveConfig` sang máy người dùng.
 */
import { loadConfig, saveConfig } from '../../config.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';
import { buildInventory } from '../../core/builds.js';

export const buildsRoutes: RouteTable = {
  'POST /api/builds/source': async (req, res, _url, ctx) => {
    const body = await readJson<{ env: string; platform: 'android' | 'ios'; useInstalled: boolean }>(req);
    if (body.platform !== 'android' && body.platform !== 'ios') {
      return json(res, 400, { error: 'Nền tảng không hợp lệ.' });
    }
    const cfg = await loadConfig(ctx.configFile);
    const env = cfg.environments[body.env];
    if (!env) return json(res, 404, { error: `Không có môi trường "${body.env}".` });
    cfg.environments[body.env] = {
      ...env,
      [body.platform]: {
        ...(body.platform === 'android' ? env.android : env.ios),
        useInstalledApp: body.useInstalled,
      },
    };
    await saveConfig(cfg, ctx.configFile);
    return json(res, 200, await buildInventory(cfg));
  },
};
