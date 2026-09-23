/**
 * Dọn artifact cũ.
 *
 * Kho dùng chung chỉ lớn lên. Một lượt chạy web sinh ra vài trăm KB, một lượt
 * chạy Android có video thì vài chục MB, và hai mươi máy chạy cả ngày là vài
 * GB mỗi tuần — không ai để ý cho tới lúc hoá đơn S3 hoặc đĩa MinIO nói ra.
 *
 * Xoá theo TUỔI, không theo số lượng. "Giữ 50 lượt gần nhất" nghe gọn hơn
 * nhưng trả lời sai câu hỏi thật: một tuần bận rộn đẩy bằng chứng của tuần
 * trước ra khỏi kho, đúng lúc người ta cần so sánh hai tuần với nhau.
 *
 * **Xoá file TRƯỚC, xoá dòng sau.** Ngược lại thì một lần hỏng giữa chừng để
 * lại file mồ côi trong kho mà không dòng nào trỏ tới — không ai biết nó tồn
 * tại, và nó nằm đó trả tiền mãi mãi. Theo thứ tự này, một lần hỏng giữa chừng
 * để lại một dòng trỏ vào file đã mất; lần dọn sau gặp lại nó, `remove` của S3
 * không phàn nàn về khoá không tồn tại, và dòng ấy biến mất.
 */
import type { ArtifactRepo } from './artifactRepo.js';
import type { ArtifactStore } from './artifacts.js';

export interface RetentionResult {
  removed: number;
  failed: number;
  bytes: number;
}

export interface RetentionDeps {
  store: ArtifactStore;
  repo: ArtifactRepo;
  orgId: string;
  /** Giữ bao nhiêu ngày. Xem `retention.keepFailedDays` trong config. */
  keepDays: number;
}

export async function sweepArtifacts(
  deps: RetentionDeps,
  now = new Date(),
): Promise<RetentionResult> {
  const result: RetentionResult = { removed: 0, failed: 0, bytes: 0 };
  const cutoff = new Date(now.getTime() - deps.keepDays * 24 * 60 * 60 * 1000);
  const old = await deps.repo.olderThan(deps.orgId, cutoff);
  if (old.length === 0) return result;

  const forgotten: string[] = [];
  for (const row of old) {
    try {
      await deps.store.remove(row.storageKey);
      forgotten.push(row.id);
      result.removed += 1;
      result.bytes += row.bytes ?? 0;
    } catch {
      // Một khoá không xoá được không được chặn những khoá còn lại: thường là
      // một lỗi tạm thời của kho, và lần dọn sau sẽ gặp lại đúng dòng ấy.
      result.failed += 1;
    }
  }

  await deps.repo.forget(forgotten);
  return result;
}
