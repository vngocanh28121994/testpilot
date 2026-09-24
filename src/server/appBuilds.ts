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
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { applyEnv, assertEnvPackage, type TestPilotConfig } from '../config.js';
import type { AppBuildRef } from '../protocol/messages.js';
import { localRunner } from '../runner/index.js';

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
  /** Nơi giữ gói `.app` đã đóng. Để test đặt vào thư mục tạm. */
  archives = ARCHIVES,
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
  if (info.isDirectory()) {
    if (platform !== 'ios' || !BUNDLE.test(abs)) {
      return {
        ok: false,
        reason: `Bản build ${key} là một thư mục nhưng không phải bản .app của simulator iOS.`,
      };
    }
    try {
      return { ok: true, build: await packBundle(abs, archives) };
    } catch (err) {
      return { ok: false, reason: `Không đóng gói được ${key}: ${(err as Error).message}` };
    }
  }
  if (!SINGLE_FILE.test(abs)) {
    return { ok: false, reason: `Bản build ${key} không phải .apk, .ipa hay thư mục .app.` };
  }

  return { ok: true, build: { key, name: path.basename(abs), ...(await hashOf(abs)) } };
}

/** Hash và cỡ của một file, nhớ theo (đường dẫn, cỡ, thời điểm sửa). */
async function hashOf(file: string): Promise<{ sha256: string; size: number }> {
  const info = await stat(file);
  const memo = `${file}|${info.size}|${info.mtimeMs}`;
  let sha256 = hashes.get(memo);
  if (!sha256) {
    sha256 = await sha256Of(file);
    hashes.set(memo, sha256);
  }
  return { sha256, size: info.size };
}

/** Thư mục `.app` của simulator. */
const BUNDLE = /\.app$/i;

/** Nơi giữ gói đã đóng, tính theo thư mục làm việc của máy chủ. */
const ARCHIVES = '.testpilot/build-archives';

/** Giữ bao nhiêu gói. Cùng lý do với đệm phía runner: đĩa không phải kho. */
const KEEP_ARCHIVES = 3;

/**
 * Đóng gói một thư mục `.app` thành `tar.gz` — MỘT LẦN cho mỗi phiên bản.
 *
 * Vì sao nhớ theo dấu vân tay thư mục chứ không theo thời điểm sửa của thư
 * mục: build lại bằng Xcode ghi đè FILE BÊN TRONG, còn thời điểm sửa của thư
 * mục gốc thì không nhất thiết đổi. Dấu vân tay tính từ (đường dẫn, loại, cỡ,
 * thời điểm sửa, quyền) của MỌI mục bên trong, nên chỉ cần một file đổi là
 * gói được đóng lại — và gói cũ không bao giờ được gửi thay cho bản mới.
 */
async function packBundle(dir: string, archives: string): Promise<AppBuildRef> {
  const fingerprint = await fingerprintDir(dir);
  const root = path.resolve(archives);
  const target = path.join(root, `${fingerprint}.tar.gz`);
  if (!(await stat(target).catch(() => undefined))) {
    await mkdir(root, { recursive: true });
    const temp = `${target}.part-${process.pid}-${Date.now()}`;
    try {
      // Qua mặt tiền runner: control plane không tự chạy lệnh. Xem
      // [bundle.ts](../runner/bundle.ts).
      await localRunner.builds.packBundle(dir, temp);
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
    await pruneArchives(root, target);
  }
  return {
    key: path.relative(process.cwd(), target),
    name: path.basename(dir),
    ...(await hashOf(target)),
    packed: 'tar.gz',
  };
}

async function fingerprintDir(dir: string): Promise<string> {
  const hash = createHash('sha256');
  // TÊN thư mục cũng vào dấu vân tay: gói mang tên ấy bên trong, và hai bản
  // `.app` cùng nội dung khác tên sẽ dùng chung một gói mở ra sai tên.
  hash.update(`${path.basename(dir)}\n`);
  const walk = async (rel: string): Promise<void> => {
    const entries = (await readdir(path.join(dir, rel), { withFileTypes: true }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const info = await lstat(path.join(dir, child));
      const kind = entry.isSymbolicLink() ? 'l' : entry.isDirectory() ? 'd' : 'f';
      hash.update(`${child}\0${kind}\0${info.size}\0${info.mtimeMs}\0${info.mode}\n`);
      if (entry.isDirectory()) await walk(child);
    }
  };
  await walk('');
  return hash.digest('hex');
}

async function pruneArchives(root: string, keep: string): Promise<void> {
  try {
    const names = (await readdir(root)).filter((name) => /^[a-f0-9]{64}\.tar\.gz$/.test(name));
    const dated = await Promise.all(names.map(async (name) => {
      const file = path.join(root, name);
      return { file, at: (await stat(file)).mtimeMs };
    }));
    dated.sort((a, b) => b.at - a.at);
    for (const { file } of dated.slice(KEEP_ARCHIVES)) {
      // Gói đang được một job trỏ tới vẫn có thể bị bỏ ở đây nếu có ba bản
      // mới hơn — job ấy sẽ nhận 410 và nói "bản build không còn". Chấp nhận
      // được: ba bản build mới trong lúc một job còn đang chờ là hiếm, và đổi
      // lại đĩa máy chủ không phình theo số lần build.
      if (file !== keep) await rm(file, { force: true });
    }
  } catch {
    // Dọn hỏng không làm hỏng việc gửi bản build.
  }
}
