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
import { FileSecretStore, mayAdoptIntoEnv, type SecretStore } from '../auth/secrets.js';
import { serverMode } from '../http.js';
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

/**
 * Kho khoá của tiến trình này.
 *
 * Chế độ `embedded` dùng `.testpilot.secrets.json` như cũ. Chế độ `server` sẽ
 * thay bằng secret manager ở P2.6 — nơi gọi không đổi, vì đó là điểm của
 * interface `SecretStore`.
 */
const store: SecretStore = new FileSecretStore();

/**
 * Nạp khoá vừa lưu vào `process.env` — CHỈ ở chế độ embedded.
 *
 * Ở đó nó tiện và vô hại: một người, một máy, và mọi thư viện đọc
 * `process.env`. Ở chế độ server thì không: `process.env` là không gian phẳng
 * dùng chung, nên khoá của một người sẽ phục vụ request của mọi tổ chức, và
 * mọi tiến trình con thừa hưởng nó. Khoá đi tới job qua `secret.grant`, theo
 * đúng những tên job ấy cần — xem `src/server/auth/secrets.ts`.
 */
function adoptLocally(name: string, value: string): void {
  if (mayAdoptIntoEnv(serverMode())) process.env[name] = value;
}

/**
 * Khoá cấu hình sẵn bằng biến môi trường — cũng CHỈ tính ở chế độ embedded.
 *
 * Một biến môi trường là một giá trị cho cả tiến trình. Ở chế độ server, để nó
 * trả lời thay cho kho theo tổ chức nghĩa là tổ chức nào chưa cấu hình gì cũng
 * lặng lẽ dùng khoá của người dựng server — đúng kiểu rò rỉ mà cả P2.3 sinh ra
 * để chặn, chỉ khác đường vào.
 */
function envFallback(name: string): string | undefined {
  return mayAdoptIntoEnv(serverMode()) ? process.env[name] : undefined;
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

  'POST /api/model-key': async (req, res, _url, ctx) => {
    const body = await readJson<{
      provider: 'anthropic' | 'deepseek' | 'gemini';
      key: string;
    }>(req);
    const name = MODEL_KEY_NAMES[body.provider];
    if (!name) return json(res, 400, { error: 'AI provider không hợp lệ.' });
    const key = body.key?.trim();
    if (!key) return json(res, 400, { error: 'API key không được để trống.' });
    await store.set(ctx.identity.orgId, name, key);
    adoptLocally(name, key);
    return json(res, 200, { ok: true });
  },

  /**
   * The Confluence credential, stored the same way model keys are: written to
   * the secret store and never read back.
   *
   * Trả về email và một BOOLEAN, không bao giờ trả token. Email là thứ người
   * dùng cần thấy để biết mình đã cấu hình tài khoản nào; token thì không có
   * lý do nào để rời khỏi server, kể cả với chính chủ.
   */
  'GET /api/confluence-auth': async (_req, res, _url, ctx) => {
    const org = ctx.identity.orgId;
    const email = (await store.get(org, 'CONFLUENCE_EMAIL')) || envFallback('CONFLUENCE_EMAIL') || '';
    const hasToken = (await store.has(org, 'CONFLUENCE_API_TOKEN'))
      || Boolean(envFallback('CONFLUENCE_API_TOKEN'));
    return json(res, 200, { email, hasToken });
  },

  'POST /api/confluence-auth': async (req, res, _url, ctx) => {
    const body = await readJson<{ email?: string; token?: string }>(req);
    const email = body.email?.trim();
    const token = body.token?.trim();
    if (!email || !token) {
      return json(res, 400, { error: 'Cần cả email Atlassian và API token.' });
    }
    const org = ctx.identity.orgId;
    await store.set(org, 'CONFLUENCE_EMAIL', email);
    await store.set(org, 'CONFLUENCE_API_TOKEN', token);
    adoptLocally('CONFLUENCE_EMAIL', email);
    adoptLocally('CONFLUENCE_API_TOKEN', token);
    return json(res, 200, { ok: true });
  },
};
