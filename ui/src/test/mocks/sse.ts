import { HttpResponse } from 'msw';

/**
 * Dựng một phản hồi SSE thật cho 8 route stream.
 *
 * Phải là `ReadableStream` với khung `event:`/`data:` đúng chuẩn, KHÔNG phải
 * JSON: nếu handler trả JSON thì `streamJob()` không bao giờ được test thật,
 * mà nó chính là thứ đỡ toàn bộ R3 và R10.
 */
export type SseFrame = [event: string, data: unknown];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function sse(frames: SseFrame[], opts: { chunkSize?: number; delayMs?: number } = {}) {
  const text = frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  // Cắt nhỏ để mô phỏng ranh giới gói TCP: mặc định 1 chunk mỗi khung, nhưng
  // test phân tích khung sẽ hạ xuống vài byte để cắt ngang giữa một khung.
  const size = opts.chunkSize ?? bytes.length;

  return new HttpResponse(
    new ReadableStream({
      // `delayMs` giữ stream mở đủ lâu để test kịp unmount component giữa
      // chừng — đó là toàn bộ kịch bản của R10.
      async start(controller) {
        for (let i = 0; i < bytes.length; i += size) {
          if (opts.delayMs) await sleep(opts.delayMs);
          controller.enqueue(bytes.slice(i, i + size));
        }
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
}
