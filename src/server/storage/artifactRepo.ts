/**
 * Sổ artifact: file nào thuộc lượt chạy nào, và nó nằm ở khoá nào trong kho.
 *
 * Vì sao cần một bảng khi kho đã có `list(prefix)`: liệt kê theo tiền tố là
 * một lời gọi mạng tới S3 cho MỖI lần mở một lượt chạy, và nó trả về đúng thứ
 * đang có trong bucket — không trả về `bytes` đã đo lúc ghi, không trả về
 * `kind`, và không phân biệt được "chưa đẩy lên" với "đã bị dọn". Bảng trả lời
 * được cả ba, và nó là chỗ duy nhất `retention` có thể đọc để biết phải xoá gì.
 *
 * Khoá lưu trong `storage_key` luôn bắt đầu bằng `orgId` — xem `artifactKey()`.
 * Nên kể cả khi một truy vấn ở đây quên `WHERE org_id`, đường dẫn vẫn không
 * trỏ sang tổ chức khác. Hai lớp cho cùng một tính chất, cố ý.
 */
import { randomUUID } from 'node:crypto';
import type { PoolProvider } from '../db/pool.js';

export type ArtifactKind = 'report' | 'screenshot' | 'video' | 'trace' | 'log' | 'apk';

export interface ArtifactRow {
  id: string;
  jobId: string;
  orgId: string;
  kind: ArtifactKind;
  storageKey: string;
  bytes?: number;
  createdAt: string;
}

export interface NewArtifact {
  jobId: string;
  orgId: string;
  kind: ArtifactKind;
  storageKey: string;
  bytes?: number;
}

export interface ArtifactRepo {
  /** Ghi nhiều dòng một lần: một lượt chạy có hàng trăm ảnh. */
  record(rows: NewArtifact[]): Promise<number>;
  forJob(orgId: string, jobId: string): Promise<ArtifactRow[]>;
  /** Dòng cũ hơn mốc, để dọn. Trả về cả khoá kho để xoá file thật. */
  olderThan(orgId: string, cutoff: Date): Promise<ArtifactRow[]>;
  forget(ids: string[]): Promise<number>;
}

/**
 * Đoán `kind` từ đường dẫn.
 *
 * Một hàm thuần và xuất ra ngoài vì nó là hợp đồng với bảng: cột `kind` có
 * `CHECK` chỉ nhận sáu giá trị, nên đoán sai ở đây là một lệnh INSERT hỏng vào
 * lúc job vừa xong — chỗ tệ nhất để hỏng.
 */
export function kindOf(relativePath: string): ArtifactKind {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'screenshot';
  }
  if (lower.endsWith('.webm') || lower.endsWith('.mp4')) return 'video';
  if (lower.endsWith('.zip')) return 'trace';
  if (lower.endsWith('.apk') || lower.endsWith('.ipa')) return 'apk';
  if (lower.endsWith('.html') || lower.endsWith('.json')) return 'report';
  return 'log';
}

interface Row {
  id: string;
  job_id: string;
  org_id: string;
  kind: ArtifactKind;
  storage_key: string;
  bytes: number | string | null;
  created_at: Date | string;
}

function hydrate(row: Row): ArtifactRow {
  return {
    id: row.id,
    jobId: row.job_id,
    orgId: row.org_id,
    kind: row.kind,
    storageKey: row.storage_key,
    ...(row.bytes != null ? { bytes: Number(row.bytes) } : {}),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export class PgArtifactRepo implements ArtifactRepo {
  /**
   * Nhận một NGUỒN pool, không phải một pool đã mở.
   *
   * Cùng lý do với `lazyRepos`: dựng kho không được mở kết nối. Bản đầu nhận
   * thẳng `Pool` và chỗ gọi phải `await` ngay lúc khởi động — `GET /api/health`
   * lúc ấy không trả lời được cho tới khi DB lên, và load balancer đọc đúng
   * câu đó rồi kết luận tiến trình đã chết.
   */
  constructor(private readonly pool: PoolProvider) {}

  async record(rows: NewArtifact[]): Promise<number> {
    if (rows.length === 0) return 0;
    const now = new Date().toISOString();
    // MỘT câu INSERT cho cả lô. Một lượt chạy có hàng trăm ảnh, và hàng trăm
    // vòng round-trip ngay lúc job vừa xong là hàng chục giây runner ngồi chờ
    // để báo một việc đã làm xong.
    const values: unknown[] = [];
    const tuples = rows.map((row, index) => {
      const at = index * 7;
      values.push(
        randomUUID(), row.jobId, row.orgId, row.kind, row.storageKey,
        row.bytes ?? null, now,
      );
      return `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7})`;
    });
    const { rowCount } = await (await this.pool()).query(
      `INSERT INTO artifact (id, job_id, org_id, kind, storage_key, bytes, created_at)
       VALUES ${tuples.join(', ')}`,
      values,
    );
    return rowCount ?? 0;
  }

  async forJob(orgId: string, jobId: string): Promise<ArtifactRow[]> {
    const { rows } = await (await this.pool()).query<Row>(
      `SELECT * FROM artifact WHERE org_id = $1 AND job_id = $2 ORDER BY storage_key`,
      [orgId, jobId],
    );
    return rows.map(hydrate);
  }

  async olderThan(orgId: string, cutoff: Date): Promise<ArtifactRow[]> {
    const { rows } = await (await this.pool()).query<Row>(
      `SELECT * FROM artifact WHERE org_id = $1 AND created_at < $2 ORDER BY created_at`,
      [orgId, cutoff.toISOString()],
    );
    return rows.map(hydrate);
  }

  async forget(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { rowCount } = await (await this.pool()).query(
      'DELETE FROM artifact WHERE id = ANY ($1)',
      [ids],
    );
    return rowCount ?? 0;
  }
}
