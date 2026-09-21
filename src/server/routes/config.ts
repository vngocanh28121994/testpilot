/**
 * Cấu hình và khoá API.
 *
 * Nhóm thứ hai được chuyển: có ghi, nhưng không stream và không chạm thiết bị.
 *
 * `PUT /api/config` là **mẫu chuẩn** cho mọi lệnh ghi có phiên bản trong hệ
 * thống — nó đã nhận `baseRevision` và trả 409 từ trước khi có kế hoạch farm,
 * và `RegistryRepo` ở P0.2 chỉ là cùng ý tưởng ấy áp cho registry.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ConfigSchema, saveConfig, type TestPilotConfig } from '../../config.js';
import { Secrets } from '../../core/secrets.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

/** Dấu vân của file config lúc đọc; trình duyệt gửi lại khi Lưu. */
export async function configRevision(configFile: string): Promise<string | undefined> {
  try {
    return createHash('sha256').update(await readFile(configFile, 'utf8')).digest('hex');
  } catch {
    return undefined;
  }
}

const MODEL_KEY_NAMES = {
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
} as const;

export const configRoutes: RouteTable = {
  'PUT /api/config': async (req, res, url, ctx) => {
    const body = await readJson<TestPilotConfig>(req);
    // Bản mà trình duyệt dựa vào khi mở màn Cấu hình. Thiếu nó thì vẫn ghi —
    // CLI và script cũ không biết gửi, và chặn chúng lại là phá việc đang chạy.
    const baseRevision = url.searchParams.get('baseRevision');
    if (baseRevision) {
      const current = await configRevision(ctx.configFile);
      if (current && current !== baseRevision) {
        return json(res, 409, {
          error:
            'Cấu hình đã thay đổi ở nơi khác kể từ lúc bạn mở màn này — '
            + 'ví dụ vừa tải một bản build lên ở màn Bản build. '
            + 'Tải lại trang rồi sửa tiếp, để thay đổi kia không bị ghi đè.',
          revision: current,
        });
      }
    }
    const parsed = ConfigSchema.safeParse(body);
    if (!parsed.success) {
      return json(res, 400, {
        error: 'Config không hợp lệ',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    await saveConfig(parsed.data, ctx.configFile);
    return json(res, 200, { ok: true, config: parsed.data });
  },

  'POST /api/model-key': async (req, res) => {
    const body = await readJson<{
      provider: 'anthropic' | 'deepseek' | 'gemini';
      key: string;
    }>(req);
    const name = MODEL_KEY_NAMES[body.provider];
    if (!name) return json(res, 400, { error: 'AI provider không hợp lệ.' });
    const key = body.key?.trim();
    if (!key) return json(res, 400, { error: 'API key không được để trống.' });
    const secrets = await Secrets.load();
    secrets.setApiKey(name, key);
    await secrets.save();
    process.env[name] = key;
    return json(res, 200, { ok: true });
  },

  /**
   * The Confluence credential, stored the same way model keys are: written to
   * the local secrets file, adopted into this process, and never read back.
   * The GET reports only whether one is set, so a screen-share of the settings
   * page cannot leak it.
   */
  'GET /api/confluence-auth': async (_req, res) => {
    const secrets = await Secrets.load();
    const email = secrets.apiKey('CONFLUENCE_EMAIL') || process.env.CONFLUENCE_EMAIL || '';
    const hasToken = Boolean(
      secrets.apiKey('CONFLUENCE_API_TOKEN') || process.env.CONFLUENCE_API_TOKEN,
    );
    return json(res, 200, { email, hasToken });
  },

  'POST /api/confluence-auth': async (req, res) => {
    const body = await readJson<{ email?: string; token?: string }>(req);
    const email = body.email?.trim();
    const token = body.token?.trim();
    if (!email || !token) {
      return json(res, 400, { error: 'Cần cả email Atlassian và API token.' });
    }
    const secrets = await Secrets.load();
    secrets.setApiKey('CONFLUENCE_EMAIL', email);
    secrets.setApiKey('CONFLUENCE_API_TOKEN', token);
    await secrets.save();
    process.env.CONFLUENCE_EMAIL = email;
    // TODO(P2.3): ghi vào `process.env` của cả tiến trình là biến token của
    // MỘT người thành token của cả server. Chấp nhận được ở chế độ embedded
    // (một người, một máy); phải bỏ trước khi mở ra domain.
    process.env.CONFLUENCE_API_TOKEN = token;
    return json(res, 200, { ok: true });
  },
};
