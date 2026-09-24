/**
 * Bản build nào một job phải cài — do MÁY CHỦ quyết định, không phải runner.
 *
 * "Bản đã tải lên" nghĩa là bản người dùng vừa đưa lên màn Bản build, và bản
 * ấy nằm trên đĩa máy chủ. Runner ở xa có config riêng với đường dẫn build
 * riêng; để nó tự đọc config của mình là để laptop cài bản build nó đang có
 * — có thể là bản cũ ba tuần — rồi báo kết quả như thể đã chạy trên bản mới.
 *
 * Nên lúc ĐẶT JOB, máy chủ tính ra bản build bằng đúng phép mà `run.ts` dùng
 * (`applyEnv` rồi lấy `<platform>.app`), gói thành `AppBuildRef` kèm hash, và
 * runner tải đúng file ấy về. Xem [appBuild.ts](../runner/appBuild.ts).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { applyEnv, assertEnvPackage, type TestPilotConfig } from '../config.js';
import type { AppBuildRef } from '../protocol/messages.js';

export type BuildLookup =
  | { ok: true; build: AppBuildRef }
  | { ok: false; reason: string };

/** Đuôi mà một file build đơn có thể mang. `.app` của simulator là THƯ MỤC. */
const SINGLE_FILE = /\.(apk|ipa)$/i;

/**
 * Hash đã tính, theo (đường dẫn, cỡ, thời điểm sửa).
 *
 * Một bản build 215 MB mất cỡ nửa giây để băm, và nó không đổi giữa hai lượt
 * chạy. Đổi file — tải bản mới lên — là đổi cỡ hoặc thời điểm sửa, nên khoá
 * này không bao giờ trả hash của một bản cũ cho một file mới.
 */
const hashes = new Map<string, string>();

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function describeBuild(
  cfg: TestPilotConfig,
  env: string | undefined,
  platform: 'android' | 'ios',
): Promise<BuildLookup> {
  const envName = env || cfg.defaultEnv;
  let effective: TestPilotConfig;
  try {
    // Cùng hai phép chặn mà `run.ts` làm trước khi cài: môi trường không có
    // bản build riêng thì KHÔNG lặng lẽ rơi về bản của môi trường mặc định —
    // mọi môi trường dùng chung bundle id, và đó là đăng nhập account SIT vào
    // app prod. Câu lỗi của `assertEnvPackage` đã nói đúng việc phải làm.
    assertEnvPackage(cfg, envName, platform);
    effective = applyEnv(cfg, envName).config;
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const key = effective[platform].app;
  if (!key) {
    return {
      ok: false,
      reason: `Máy chủ chưa có bản build ${platform} cho môi trường "${envName}". `
        + 'Mở màn Bản build và tải bản build lên.',
    };
  }
  const abs = path.resolve(key);
  const info = await stat(abs).catch(() => undefined);
  if (!info) {
    return { ok: false, reason: `Config trỏ tới ${key} nhưng file ấy không có trên máy chủ.` };
  }
  if (info.isDirectory() || !SINGLE_FILE.test(abs)) {
    // Bản `.app` cho simulator là một THƯ MỤC. Gửi nó cần đóng gói rồi mở ra
    // ở đầu kia — một việc riêng. Nói ra thay vì gửi nửa vời.
    return {
      ok: false,
      reason: `Bản build ${key} không phải một file .apk/.ipa đơn, nên chưa gửi sang runner khác được. `
        + 'Chọn "Bản có sẵn trên thiết bị", hoặc cắm máy vào chính máy chủ.',
    };
  }

  const memo = `${abs}|${info.size}|${info.mtimeMs}`;
  let sha256 = hashes.get(memo);
  if (!sha256) {
    sha256 = await sha256Of(abs);
    hashes.set(memo, sha256);
  }
  return { ok: true, build: { key, name: path.basename(abs), sha256, size: info.size } };
}
