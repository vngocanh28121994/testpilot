import type { JobFrame, WorkflowRun } from '@core/ui/contracts.js';
import { ApiRequestError } from '@/api/client';

/**
 * Đọc một stream SSE-over-POST. Thuần logic — không React, không DOM.
 *
 * Port từ `streamInto()` ở app.js:5690, tách phần phân tích khung ra khỏi phần
 * vẽ DOM (bản cũ làm cả hai trong một hàm) và thêm AbortSignal.
 *
 * Vì sao không dùng EventSource: 9 route này là POST, mà EventSource chỉ biết
 * GET. Đó là ràng buộc của backend hiện có chứ không phải một lựa chọn.
 */
export async function streamJob(
  path: string,
  body: unknown,
  onFrame: (frame: JobFrame) => void,
  signal?: AbortSignal,
  /**
   * GET dùng cho việc NỐI LẠI một lượt đang chạy: nó không khởi động gì cả,
   * chỉ đọc. Gửi POST tới đó sẽ là bảo server "chạy đi" một lần nữa.
   */
  method: 'POST' | 'GET' = 'POST',
): Promise<{ lastRun: WorkflowRun | null; ok: boolean }> {
  const res = await fetch(path, {
    method,
    ...(method === 'POST'
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }
      : {}),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiRequestError(data.error ?? res.statusText, path, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastRun: WorkflowRun | null = null;
  let failure: string | null = null;
  let ok = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Khung SSE ngăn nhau bằng một dòng trống. Phần đuôi chưa đủ một khung
      // phải ở lại buffer: ranh giới gói TCP không trùng ranh giới khung, nên
      // một dòng log dài hoàn toàn có thể bị cắt làm đôi giữa hai lần read().
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const raw = /^data: (.*)$/m.exec(frame)?.[1];
        if (!event || raw === undefined) continue;

        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          continue; // khung hỏng: bỏ qua chứ không giết cả stream
        }

        if (event === 'log') {
          onFrame({ type: 'log', line: String(data) });
        } else if (event === 'run') {
          lastRun = data as WorkflowRun;
          onFrame({ type: 'run', run: lastRun });
        } else if (event === 'error') {
          failure = String(data);
          onFrame({ type: 'error', message: failure });
        } else if (event === 'done') {
          ok = Boolean((data as { ok?: boolean }).ok);
          onFrame({ type: 'done', ok });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (failure) {
    const err = new ApiRequestError(failure, path, 200);
    // Khung `error` đến xen giữa các dòng log và đã được in ra console theo
    // đúng thứ tự. Cờ này nói với caller: đừng toast lại. Giữ nguyên quy ước
    // `err.printed` của app.js:5738 — thiếu nó thì mọi lỗi hiện đúng hai lần.
    err.printed = true;
    throw err;
  }
  return { lastRun, ok };
}
