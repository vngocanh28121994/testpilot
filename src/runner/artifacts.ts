/**
 * Đẩy bằng chứng của một lượt chạy lên kho dùng chung.
 *
 * Vì sao runner không cầm khoá bucket: nó chạy trên laptop của một người, và
 * hai mươi bản sao của một khoá ghi được vào kho của cả tổ chức là hai mươi
 * chỗ để mất nó — không thu lại được cái nào khi một máy bị mất cắp. Nên server
 * phát link có chữ ký cho ĐÚNG những khoá nó tự dựng, và runner chỉ biết những
 * link ấy.
 *
 * **Không bao giờ làm hỏng một job.** Artifact là bằng chứng, không phải kết
 * quả: suite đã chạy xong, verdict đã có. Một lượt chạy báo "thất bại" chỉ vì
 * mạng rớt lúc tải ảnh lên là nói dối về thứ đắt hơn nhiều. Nên mọi lỗi ở đây
 * trở thành một dòng log, không thành một ngoại lệ.
 */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

/** Xin link theo lô. Cùng con số với giới hạn ở route. */
const BATCH = 500;

/**
 * File nào KHÔNG đẩy lên.
 *
 * `learned.json` đi theo đường riêng — nó là phần lượt chạy học được, gửi kèm
 * `JobResult.registryProposal` để control plane quyết định gộp hay treo lại
 * chờ duyệt. Đẩy nó lên kho artifact nữa là hai bản của cùng một sự thật, và
 * bản trong kho sẽ không bao giờ được ai đọc.
 */
const SKIP = new Set(['learned.json']);

export interface UploadDeps {
  /** Xin link ghi. Trả về đúng thứ tự file đã hỏi. */
  sign(jobId: string, files: string[]): Promise<Array<{
    file: string; key: string; url: string; contentType: string;
  }>>;
  /** Báo đã ghi xong những gì. */
  done(jobId: string, files: Array<{ key: string; bytes: number }>): Promise<void>;
  /** Tiêm để test không phải gọi mạng thật. */
  put?(url: string, body: Readable, contentType: string, bytes: number): Promise<void>;
  log(line: string): void;
}

export interface UploadSummary {
  uploaded: number;
  failed: number;
  bytes: number;
}

async function filesUnder(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, base)));
    else if (!SKIP.has(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Đẩy các thư mục lượt chạy lên, theo lô.
 *
 * Đường dẫn gửi cho server có tiền tố là TÊN THƯ MỤC lượt chạy, không phải
 * đường dẫn tuyệt đối trên máy runner: `runs/2026-09-23T10-00-00/report.html`
 * là thứ người đọc nhận ra, còn `/Users/an/projects/...` vừa vô nghĩa với họ
 * vừa nói ra tên người dùng trên máy của một người.
 */
export async function uploadRuns(
  runDirs: string[],
  jobId: string,
  deps: UploadDeps,
): Promise<UploadSummary> {
  const summary: UploadSummary = { uploaded: 0, failed: 0, bytes: 0 };
  const put = deps.put ?? httpPut;

  for (const dir of runDirs) {
    const runName = path.basename(dir);
    let relatives: string[];
    try {
      relatives = await filesUnder(dir);
    } catch (err) {
      deps.log(`[job] ⚠ không đọc được thư mục ${runName}: ${(err as Error).message}`);
      continue;
    }

    for (let at = 0; at < relatives.length; at += BATCH) {
      const lot = relatives.slice(at, at + BATCH);
      let links: Awaited<ReturnType<UploadDeps['sign']>>;
      try {
        links = await deps.sign(jobId, lot.map((rel) => `${runName}/${posix(rel)}`));
      } catch (err) {
        deps.log(`[job] ⚠ server không cấp được link tải lên: ${(err as Error).message}`);
        summary.failed += lot.length;
        continue;
      }

      const recorded: Array<{ key: string; bytes: number }> = [];
      for (const [index, link] of links.entries()) {
        const local = path.join(dir, lot[index]!);
        try {
          const info = await stat(local);
          // `createReadStream` chứ không `readFile`: một video 80 MB đọc hết
          // vào RAM rồi mới gửi là 80 MB nằm trong heap của một tiến trình
          // đang giữ nhiều lượt chạy cùng lúc.
          await put(link.url, createReadStream(local), link.contentType, info.size);
          recorded.push({ key: link.key, bytes: info.size });
          summary.bytes += info.size;
        } catch (err) {
          summary.failed += 1;
          deps.log(`[job] ⚠ không tải lên được ${link.file}: ${(err as Error).message}`);
        }
      }

      if (recorded.length === 0) continue;
      try {
        // Báo SAU khi ghi, không phải lúc xin link: xin link không có nghĩa là
        // ghi được, và một dòng trong sổ nói "có file này" trong khi kho không
        // có gì thì màn hình sẽ vẽ ra một liên kết hỏng.
        await deps.done(jobId, recorded);
        summary.uploaded += recorded.length;
      } catch (err) {
        summary.failed += recorded.length;
        deps.log(`[job] ⚠ không ghi được sổ artifact: ${(err as Error).message}`);
      }
    }
  }

  if (summary.uploaded > 0) {
    deps.log(`[job] Đã tải lên ${summary.uploaded} file (${mb(summary.bytes)}).`);
  }
  if (summary.failed > 0) {
    deps.log(`[job] ⚠ ${summary.failed} file không tải lên được; lượt chạy vẫn tính là xong.`);
  }
  return summary;
}

function posix(relative: string): string {
  return relative.split(path.sep).join('/');
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * PUT thẳng lên S3 bằng link có chữ ký.
 *
 * `content-length` bắt buộc: `fetch` với một stream mà không có độ dài sẽ dùng
 * chunked encoding, và S3 từ chối chunked trên một link đã ký — lỗi trả về nói
 * về chữ ký, nên người đọc đi tìm sai chỗ hoàn toàn.
 */
async function httpPut(
  url: string,
  body: Readable,
  contentType: string,
  bytes: number,
): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'content-length': String(bytes) },
    body: Readable.toWeb(body) as unknown as BodyInit,
    // `duplex` bắt buộc khi thân là stream. Thiếu nó thì Node ném một lỗi nói
    // về `RequestInit`, không nói gì về việc tải lên.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  if (!res.ok) throw new Error(`S3 trả ${res.status}`);
}
