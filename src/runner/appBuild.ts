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
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { AppBuildRef } from '../protocol/messages.js';

const execFileAsync = promisify(execFile);

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

/**
 * Tên trên đĩa, đã kiểm: tên tới từ mạng và đi vào một đường dẫn.
 *
 * File đơn thì đuôi `.apk`/`.ipa`. Gói thì `name` là tên thư mục `.app` sau
 * khi mở — tên trần, không có dấu gạch chéo, không bắt đầu bằng dấu chấm.
 */
function checkedName(build: AppBuildRef): string {
  if (!/^[a-f0-9]{64}$/.test(build.sha256)) {
    throw new Error('Mã băm của bản build không hợp lệ.');
  }
  if (build.packed) {
    if (build.packed !== 'tar.gz' || !/^[^/\\]+\.app$/i.test(build.name) || build.name.startsWith('.')) {
      throw new Error(`Bản build đóng gói "${build.name}" không phải một thư mục .app.`);
    }
    return build.name;
  }
  const ext = path.extname(build.name).toLowerCase();
  if (ext !== '.apk' && ext !== '.ipa') {
    throw new Error(`Bản build "${build.name}" không phải .apk hay .ipa.`);
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

  /**
   * Tải ĐÚNG những byte của job về `dest`, kiểm cỡ và hash — hoặc ném.
   * Một lần tải đứt, hay một proxy chèn trang lỗi, không để lại gì trên đĩa.
   */
  const download = async (jobId: string, build: AppBuildRef, dest: string, log: (l: string) => void) => {
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
      await pipeline(Readable.fromWeb(res.body as never), tally, createWriteStream(dest));
    } catch (err) {
      await rm(dest, { force: true });
      throw new Error(`Tải bản build ${build.name} bị đứt: ${(err as Error).message}`);
    }
    const got = hash.digest('hex');
    if (bytes !== build.size || got !== build.sha256) {
      await rm(dest, { force: true });
      throw new Error(
        `Bản build ${build.name} tải về không khớp với bản máy chủ đã chọn `
        + `(${megabytes(bytes)}, hash ${got.slice(0, 12)}… thay vì ${build.sha256.slice(0, 12)}…). `
        + 'Không cài một bản không kiểm được.',
      );
    }
    log(`[build] Đã tải và kiểm xong trong ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  };

  return async (jobId, build, log) => {
    const name = checkedName(build);
    await mkdir(cacheDir, { recursive: true });

    if (build.packed) return fetchBundle(jobId, build, name, cacheDir, download, log);

    const target = path.join(cacheDir, `${build.sha256}${name}`);
    // Tên file CHÍNH LÀ hash, và file chỉ được đặt vào tên ấy sau khi hash đã
    // được kiểm — nên có file đúng tên và đúng cỡ là đủ để tin nó.
    const cached = await stat(target).catch(() => undefined);
    if (cached?.size === build.size) {
      log(`[build] Dùng ${build.name} đã có sẵn trên máy này (${megabytes(build.size)}).`);
      await touch(target);
      return target;
    }
    const temp = `${target}.part-${process.pid}-${Date.now()}`;
    await download(jobId, build, temp, log);
    await rename(temp, target);
    await prune(cacheDir, target);
    return target;
  };
}

/** Chạm thời điểm sửa để phép dọn đệm biết bản này vừa được dùng. */
async function touch(file: string): Promise<void> {
  const now = new Date();
  await utimes(file, now, now).catch(() => undefined);
}

/** Dấu "đã mở gói xong" — chỉ ghi khi mọi thứ đã nằm đúng chỗ. */
const COMPLETE = '.complete';

/**
 * Bản `.app` của simulator: tải gói, KIỂM từng mục, rồi mở vào đệm.
 *
 * Đệm là `<hash>/<Tên>.app`, và chỉ được tin khi có dấu `.complete` — ghi SAU
 * CÙNG, sau khi thư mục đã nằm đúng chỗ. Một lần mở gói bị ngắt giữa chừng để
 * lại một `.app` thiếu nửa file; tin nó là cài một app hỏng rồi đổ lỗi cho
 * simulator.
 *
 * Mở một lần cho mỗi phiên bản. Để Appium tự giải một file `.zip` thì nó giải
 * lại ở MỖI phiên — vài trăm MB mỗi lượt chạy.
 */
async function fetchBundle(
  jobId: string,
  build: AppBuildRef,
  name: string,
  cacheDir: string,
  download: (jobId: string, build: AppBuildRef, dest: string, log: (l: string) => void) => Promise<void>,
  log: (line: string) => void,
): Promise<string> {
  const home = path.join(cacheDir, build.sha256);
  const bundle = path.join(home, name);
  if (await stat(path.join(home, COMPLETE)).catch(() => undefined)) {
    log(`[build] Dùng ${name} đã có sẵn trên máy này.`);
    await touch(home);
    return bundle;
  }

  const stamp = `${process.pid}-${Date.now()}`;
  const archive = path.join(cacheDir, `${build.sha256}.tar.gz.part-${stamp}`);
  const staging = path.join(cacheDir, `${build.sha256}.part-${stamp}`);
  try {
    await download(jobId, build, archive, log);
    await assertSafeArchive(archive, name);
    await mkdir(staging, { recursive: true });
    await execFileAsync('tar', ['-xzf', archive, '-C', staging], { maxBuffer: 16 * 1024 * 1024 });
    const opened = await stat(path.join(staging, name)).catch(() => undefined);
    if (!opened?.isDirectory()) {
      throw new Error(`Gói bản build không chứa thư mục ${name}.`);
    }
    await writeFile(path.join(staging, COMPLETE), `${build.sha256}\n`);
    await rm(home, { recursive: true, force: true });
    await rename(staging, home);
    log(`[build] Đã mở ${name} vào đệm.`);
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
  await prune(cacheDir, home);
  return bundle;
}

/**
 * Mọi mục trong gói phải nằm TRONG thư mục `.app` — kiểm TRƯỚC khi mở.
 *
 * Gói tới từ mạng. Hash đã khớp nghĩa là nó đúng là thứ máy chủ gửi — không
 * có nghĩa máy chủ không bị chiếm. Một mục `../../.zshrc` hay `/etc/…` trong
 * gói là ghi file tuỳ ý lên laptop người khác. `tar` của macOS tự từ chối
 * phần lớn các mục ấy; phép kiểm này không dựa vào việc đó.
 */
async function assertSafeArchive(archive: string, name: string): Promise<void> {
  const { stdout } = await execFileAsync('tar', ['-tzf', archive], { maxBuffer: 64 * 1024 * 1024 });
  const entries = stdout.split('\n').filter(Boolean);
  if (entries.length === 0) throw new Error('Gói bản build rỗng.');
  for (const entry of entries) {
    const clean = entry.replace(/^\.\//, '');
    const parts = clean.split('/');
    const inside = clean === name || clean === `${name}/` || clean.startsWith(`${name}/`);
    if (clean.startsWith('/') || parts.includes('..') || !inside) {
      throw new Error(`Gói bản build có mục nằm ngoài ${name}: "${entry}". Không mở.`);
    }
  }
}

/**
 * Bỏ bớt bản build cũ, giữ `KEEP` bản dùng gần nhất.
 *
 * Hỏng ở đây KHÔNG làm hỏng lượt chạy: bản cần đã nằm sẵn, còn đệm hơi to
 * một chút thì không ai chết.
 */
async function prune(cacheDir: string, keep: string): Promise<void> {
  try {
    // File đơn `<hash>.apk|.ipa` và thư mục `<hash>` của bản `.app` đã mở.
    const names = (await readdir(cacheDir)).filter((name) => /^[a-f0-9]{64}(\.(apk|ipa))?$/.test(name));
    const dated = await Promise.all(names.map(async (name) => {
      const file = path.join(cacheDir, name);
      return { file, at: (await stat(file)).mtimeMs };
    }));
    dated.sort((a, b) => b.at - a.at);
    for (const { file } of dated.slice(KEEP)) {
      if (file !== keep) await rm(file, { recursive: true, force: true });
    }
  } catch {
    // Xem chú thích ở trên.
  }
}

function megabytes(size: number): string {
  return `${Math.round(size / 1024 / 1024)} MB`;
}
