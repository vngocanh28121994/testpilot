import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Kịch bản đỏ vì sản phẩm chưa đáp ứng, không phải vì test hỏng.
 *
 * Có những kịch bản đúng, gen đúng, chạy đúng — và đỏ, vì ứng dụng chưa làm
 * được điều nó kiểm. Ví dụ có thật: app loại tiểu khoản nguồn khỏi danh sách
 * đích nhưng không làm chiều ngược lại. Kịch bản mô tả đúng yêu cầu; app chưa
 * đáp ứng.
 *
 * Gộp nó vào cùng con số với "test hỏng" gây ra hai hậu quả ngược nhau và đều
 * tệ: hoặc người ta xoá kịch bản đúng để suite xanh, hoặc quen dần với một
 * suite luôn đỏ rồi thôi không đọc nữa. Nên nó được đếm riêng: 8✓ 0✗ 1⚠.
 */
export interface KnownIssue {
  /** Khoá theo scenarioId, giống mọi thứ khác trong hệ thống. */
  id: string;
  filename: string;
  scenarioName: string;
  /**
   * Băm của chính nội dung kịch bản lúc nhãn được gắn.
   *
   * Nhãn thuộc về đúng những bước đã được người ta xem xét, không thuộc về cái
   * tên. Sửa một ký tự là hash đổi, nhãn hết hiệu lực và phải xác nhận lại —
   * cùng nguyên tắc với cổng duyệt, và vì cùng một lý do: một cái tên cũ không
   * được phép bảo lãnh cho những bước chưa ai đọc.
   */
  contentHash: string;
  /** Vì sao. Bắt buộc — một nhãn không kèm lý do thì năm sau không ai giải thích được. */
  note: string;
  markedAt: string;
}

interface KnownIssueDb {
  version: 1;
  entries: Record<string, KnownIssue>;
}

const emptyDb = (): KnownIssueDb => ({ version: 1, entries: {} });

export class KnownIssueStore {
  private dirty = false;

  private constructor(
    private readonly file: string,
    private readonly db: KnownIssueDb,
  ) {}

  static async load(file: string): Promise<KnownIssueStore> {
    if (!existsSync(file)) return new KnownIssueStore(file, emptyDb());
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<KnownIssueDb>;
      return new KnownIssueStore(file, {
        version: 1,
        entries: raw.entries ?? {},
      });
    } catch {
      // Một file hỏng không được phép chặn cả lượt chạy: mất nhãn thì kịch bản
      // quay về đỏ thật, thứ vốn là mặc định an toàn.
      return new KnownIssueStore(file, emptyDb());
    }
  }

  /**
   * Nhãn còn hiệu lực cho kịch bản này không.
   *
   * `contentHash` là của kịch bản ĐANG chạy. Khác với lúc gắn nhãn nghĩa là nội
   * dung đã đổi, nên câu trả lời là không — dù cái tên vẫn thế.
   */
  active(id: string, contentHash: string): KnownIssue | undefined {
    const entry = this.db.entries[id];
    return entry && entry.contentHash === contentHash ? entry : undefined;
  }

  /** Nhãn đã gắn nhưng nội dung kịch bản đã đổi kể từ đó. */
  stale(id: string, contentHash: string): KnownIssue | undefined {
    const entry = this.db.entries[id];
    return entry && entry.contentHash !== contentHash ? entry : undefined;
  }

  list(): KnownIssue[] {
    return Object.values(this.db.entries);
  }

  mark(issue: Omit<KnownIssue, 'markedAt'>): KnownIssue {
    const note = issue.note.trim();
    if (!note) throw new Error('Known issue phải kèm lý do.');
    const entry: KnownIssue = { ...issue, note, markedAt: new Date().toISOString() };
    this.db.entries[issue.id] = entry;
    this.dirty = true;
    return entry;
  }

  /**
   * Gỡ mọi nhãn thuộc một file feature. Trả về số nhãn đã gỡ.
   *
   * Dùng khi file được sinh lại: cả đợt trở thành bản nháp mới, nên những quyết
   * định của con người về nội dung cũ không được phép đi theo.
   */
  forgetFile(filename: string): number {
    const ids = Object.entries(this.db.entries)
      .filter(([, entry]) => entry.filename === filename)
      .map(([id]) => id);
    for (const id of ids) delete this.db.entries[id];
    if (ids.length > 0) this.dirty = true;
    return ids.length;
  }

  unmark(id: string): boolean {
    if (!this.db.entries[id]) return false;
    delete this.db.entries[id];
    this.dirty = true;
    return true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(this.db, null, 2)}\n`, 'utf8');
    this.dirty = false;
  }
}
