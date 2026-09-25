/**
 * Nút Dừng dừng ĐÚNG lượt chạy đang xem — không phải mọi thứ máy chủ đang chạy.
 *
 * Từ khi mỗi thiết bị chạy một job, "dừng test" gửi trần lên máy chủ nghĩa là
 * dừng luôn job của người khác trên chiếc máy bên cạnh. Mã job đã nằm sẵn trong
 * log của lượt này (dòng "[job] <mã> đã vào hàng đợi." máy chủ in ra ngay khi
 * đặt job), nên đọc lại từ đó thay vì giữ thêm một bản sao trạng thái.
 */

/** Có tiền tố tên máy khi một lượt bắc nhiều runner: "[máy A] [job] …". */
const QUEUED_LINE = /\[job\] ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) đã vào hàng đợi/i;

export function jobIdsIn(logs: string[]): string[] {
  const ids: string[] = [];
  for (const line of logs) {
    const id = QUEUED_LINE.exec(line)?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface StopResult {
  jobId: string;
  outcome: 'cancelled' | 'stopping' | 'finished' | 'elsewhere' | 'forbidden' | 'missing';
  message: string;
}

export interface StopResponse {
  stopped: boolean;
  results?: StopResult[];
}

/**
 * Một câu cho người vừa bấm Dừng. `tone` quyết định màu của thông báo: dừng
 * được hết là "ok", còn job nào KHÔNG dừng được thì phải nói ra — im lặng thì
 * người dùng tưởng điện thoại đã thôi bấm.
 */
export function describeStop(res: StopResponse): { tone: 'ok' | 'warn'; text: string } {
  const results = res.results;
  // Máy chủ cũ, hoặc không gửi mã job nào: chỉ còn câu chung.
  if (!results) return { tone: 'ok', text: 'Đã gửi yêu cầu dừng test.' };
  const blocked = results.filter((r) => r.outcome === 'elsewhere' || r.outcome === 'forbidden');
  if (blocked.length > 0) return { tone: 'warn', text: blocked[0]!.message };
  if (results.some((r) => r.outcome === 'stopping')) return { tone: 'ok', text: 'Đang dừng lượt chạy.' };
  if (results.some((r) => r.outcome === 'cancelled')) return { tone: 'ok', text: 'Đã huỷ job đang chờ.' };
  return { tone: 'ok', text: 'Lượt chạy đã kết thúc trước đó.' };
}
