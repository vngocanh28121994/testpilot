/**
 * Đẩy một thư mục lượt chạy lên kho artifact.
 *
 * Runner gọi hàm này khi job xong. Ở chế độ embedded nó không được gọi — file
 * đã nằm đúng chỗ rồi, và đẩy lên một kho ở localhost chỉ để đọc lại từ đó là
 * chép dữ liệu qua lại không vì gì cả.
 */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { artifactKey, type ArtifactRef, type ArtifactStore } from './artifacts.js';

/** Kiểu nội dung theo đuôi file. Sai kiểu thì trình duyệt TẢI VỀ thay vì mở. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
};

export function contentTypeOf(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

async function filesUnder(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

export interface UploadResult {
  uploaded: ArtifactRef[];
  /** File không đẩy được, kèm lý do. Một lượt chạy KHÔNG hỏng vì thiếu một ảnh. */
  failed: Array<{ file: string; error: string }>;
  totalBytes: number;
}

/**
 * Đẩy toàn bộ thư mục, và không bao giờ ném.
 *
 * Artifact là bằng chứng, không phải kết quả. Một lượt chạy đã xong mà báo
 * "thất bại" chỉ vì mạng rớt lúc tải ảnh lên là nói dối về thứ đắt hơn nhiều:
 * suite đã chạy, kết quả đã có. Nên hàm này trả về danh sách hỏng để người gọi
 * nói ra, thay vì làm hỏng cả job.
 */
export async function uploadRunDirectory(
  store: ArtifactStore,
  dir: string,
  meta: { orgId: string; jobId: string },
): Promise<UploadResult> {
  const result: UploadResult = { uploaded: [], failed: [], totalBytes: 0 };
  let files: string[];
  try {
    files = await filesUnder(dir);
  } catch (err) {
    result.failed.push({ file: dir, error: (err as Error).message });
    return result;
  }

  for (const relative of files) {
    const full = path.join(dir, relative);
    try {
      const info = await stat(full);
      // `createReadStream` chứ không `readFile`: một video 80 MB đọc hết vào
      // RAM rồi mới gửi là 80 MB nằm trong heap của tiến trình đang giữ nhiều
      // lượt chạy cùng lúc.
      const ref = await store.put(
        artifactKey(meta.orgId, meta.jobId, relative.split(path.sep).join('/')),
        createReadStream(full),
        contentTypeOf(relative),
      );
      result.uploaded.push({ ...ref, bytes: info.size });
      result.totalBytes += info.size;
    } catch (err) {
      result.failed.push({ file: relative, error: (err as Error).message });
    }
  }
  return result;
}
