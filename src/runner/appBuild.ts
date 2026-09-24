/**
 * Lấy bản build máy chủ đã chọn về máy runner — một lần, rồi giữ đệm.
 *
 * Trước file này, "bản đã tải lên" trên một runner ở xa nghĩa là runner cài
 * bản build nằm trên đĩa của CHÍNH nó: config của laptop trỏ tới file của
 * laptop. Người dùng tải bản mới lên máy chủ, bấm chạy, và lượt chạy diễn ra
 * trên bản cũ — với một report trông hoàn toàn bình thường.
 *
 * Ba điều file này giữ:
 *
 * - **Runner không chọn file.** Nó xin "bản build của job tôi đang giữ";
 *   máy chủ tra từ job. Xem `GET /api/runner/build`.
 * - **Runner tự kiểm cái nó nhận.** SHA-256 so với con số máy chủ ghi trong
 *   job. Một lần tải đứt giữa chừng, hay một proxy công ty chèn trang lỗi vào
 *   luồng, sẽ cho ra một file có cỡ gần đúng — và Appium cài nó rồi hỏng ở
 *   bước thứ ba bằng một câu không ai hiểu.
 * - **Tải một lần.** Đệm khoá theo hash, nên bản 215 MB chỉ đi qua mạng khi
 *   nó thật sự đổi. Và đệm có TRẦN: laptop của một người không phải kho lưu
 *   mọi bản build từng được tải lên.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppBuildRef } from '../protocol/messages.js';

/** Đệm nằm cạnh thư mục job, tính theo thư mục làm việc của runner. */
const CACHE_DIR = '.testpilot/builds';

/**
 * Giữ bao nhiêu bản build.
 *
 * Ba: đủ cho một lượt chạy xen kẽ hai môi trường mà không tải lại qua lại,
 * và chừng 650 MB cho một app cỡ bản đang dùng. Nhiều hơn thì đệm lớn dần
 * theo số lần tải lên, trên một chiếc máy không phải của máy chủ.
 */
const KEEP = 3;

export type BuildFetcher = (
  jobId: string,
  build: AppBuildRef,
  log: (line: string) => void,
) => Promise<string>;

/** Đuôi file, đã kiểm: tên tới từ mạng và đi vào một đường dẫn trên đĩa. */
function extensionOf(build: AppBuildRef): string {
  const ext = path.extname(build.name).toLowerCase();
  if (ext !== '.apk' && ext !== '.ipa') {
    throw new Error(`Bản build "${build.name}" không phải .apk hay .ipa.`);
  }
  if (!/^[a-f0-9]{64}$/.test(build.sha256)) {
    throw new Error('Mã băm của bản build không hợp lệ.');
  }
  return ext;
}

export function buildFetcher(opts: {
  serverUrl: string;
  token: string;
  name: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}): BuildFetcher {
  const cacheDir = path.resolve(opts.cacheDir ?? CACHE_DIR);
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async (jobId, build, log) => {
    const target = path.join(cacheDir, `${build.sha256}${extensionOf(build)}`);

    // Tên file CHÍNH LÀ hash, và file chỉ được đặt vào tên ấy sau khi hash đã
    // được kiểm — nên có file đúng tên và đúng cỡ là đủ để tin nó.
    const cached = await stat(target).catch(() => undefined);
    if (cached?.size === build.size) {
      log(`[build] Dùng ${build.name} đã có sẵn trên máy này (${megabytes(build.size)}).`);
      // Chạm thời điểm sửa để phép dọn đệm biết bản này vừa được dùng.
      const now = new Date();
      await utimes(target, now, now).catch(() => undefined);
      return target;
    }

    await mkdir(cacheDir, { recursive: true });
    log(`[build] Tải ${build.name} từ máy chủ (${megabytes(build.size)})…`);
    const started = Date.now();
    const res = await fetchImpl(
      `${opts.serverUrl}/api/runner/build?job=${encodeURIComponent(jobId)}`,
      { headers: { authorization: `Bearer ${opts.token}`, 'x-runner-name': opts.name } },
    );
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let reason = text.slice(0, 300);
      try { reason = (JSON.parse(text) as { error?: string }).error ?? reason; } catch { /* không phải JSON */ }
      throw new Error(`Không tải được bản build ${build.name}: ${reason || `HTTP ${res.status}`}`);
    }

    const temp = `${target}.part-${process.pid}-${Date.now()}`;
    const hash = createHash('sha256');
    let bytes = 0;
    const tally = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        bytes += chunk.length;
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), tally, createWriteStream(temp));
    } catch (err) {
      await rm(temp, { force: true });
      throw new Error(`Tải bản build ${build.name} bị đứt: ${(err as Error).message}`);
    }

    const got = hash.digest('hex');
    if (bytes !== build.size || got !== build.sha256) {
      await rm(temp, { force: true });
      throw new Error(
        `Bản build ${build.name} tải về không khớp với bản máy chủ đã chọn `
        + `(${megabytes(bytes)}, hash ${got.slice(0, 12)}… thay vì ${build.sha256.slice(0, 12)}…). `
        + 'Không cài một bản không kiểm được.',
      );
    }
    await rename(temp, target);
    log(`[build] Đã tải và kiểm xong trong ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    await prune(cacheDir, target);
    return target;
  };
}

/**
 * Bỏ bớt bản build cũ, giữ `KEEP` bản dùng gần nhất.
 *
 * Hỏng ở đây KHÔNG làm hỏng lượt chạy: bản cần đã nằm sẵn, còn đệm hơi to
 * một chút thì không ai chết.
 */
async function prune(cacheDir: string, keep: string): Promise<void> {
  try {
    const names = (await readdir(cacheDir)).filter((name) => /^[a-f0-9]{64}\.(apk|ipa)$/.test(name));
    const dated = await Promise.all(names.map(async (name) => {
      const file = path.join(cacheDir, name);
      return { file, at: (await stat(file)).mtimeMs };
    }));
    dated.sort((a, b) => b.at - a.at);
    for (const { file } of dated.slice(KEEP)) {
      if (file !== keep) await rm(file, { force: true });
    }
  } catch {
    // Xem chú thích ở trên.
  }
}

function megabytes(size: number): string {
  return `${Math.round(size / 1024 / 1024)} MB`;
}
