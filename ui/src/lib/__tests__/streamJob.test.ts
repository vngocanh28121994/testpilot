import { describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { streamJob } from '@/lib/streamJob';
import { ApiRequestError } from '@/api/client';
import type { JobFrame } from '@core/ui/contracts.js';

const URL_ = '/api/stream-thu';

async function collect(chunkSize?: number, frames = defaultFrames) {
  server.use(http.post(URL_, () => sse(frames, chunkSize ? { chunkSize } : {})));
  const got: JobFrame[] = [];
  const result = await streamJob(URL_, {}, (f) => got.push(f));
  return { got, result };
}

const defaultFrames: [string, unknown][] = [
  ['log', 'dòng một'],
  ['log', 'dòng hai'],
  ['done', { ok: true }],
];

describe('streamJob', () => {
  it('phân tích được log và done', async () => {
    const { got, result } = await collect();
    expect(got).toEqual([
      { type: 'log', line: 'dòng một' },
      { type: 'log', line: 'dòng hai' },
      { type: 'done', ok: true },
    ]);
    expect(result.ok).toBe(true);
  });

  /**
   * Lý do `buffer` tồn tại trong streamJob.
   *
   * Ranh giới gói TCP không trùng ranh giới khung SSE: một dòng log dài hoàn
   * toàn có thể bị cắt làm đôi giữa hai lần read(). Cắt 1 byte/chunk là trường
   * hợp cực đoan của đúng hiện tượng đó — nếu code nối buffer sai, test này là
   * chỗ duy nhất phát hiện ra, vì mạng thật hiếm khi cắt đủ xấu.
   */
  it('ghép đúng khi khung bị cắt ngang giữa hai chunk', async () => {
    const { got } = await collect(1);
    expect(got).toEqual([
      { type: 'log', line: 'dòng một' },
      { type: 'log', line: 'dòng hai' },
      { type: 'done', ok: true },
    ]);
  });

  it('giữ nguyên dòng có ký tự tiếng Việt và JSON lồng nhau', async () => {
    const { got } = await collect(3, [
      ['log', 'Đang tải bản build… 45% ✓'],
      ['run', { id: 'r1', stage: 'gen' }],
      ['done', { ok: true }],
    ]);
    expect(got[0]).toEqual({ type: 'log', line: 'Đang tải bản build… 45% ✓' });
    expect(got[1]).toMatchObject({ type: 'run', run: { id: 'r1' } });
  });

  it('ném lỗi có cờ printed khi nhận khung error', async () => {
    server.use(
      http.post(URL_, () =>
        sse([
          ['log', 'bắt đầu'],
          ['error', 'Appium chưa cài'],
          ['done', { ok: false }],
        ]),
      ),
    );
    const seen: JobFrame[] = [];
    const err = (await streamJob(URL_, {}, (f) => seen.push(f)).catch((e: unknown) => e)) as ApiRequestError;

    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.message).toBe('Appium chưa cài');
    // `printed` nói với caller: thông báo đã nằm trong console theo đúng thứ tự
    // với các dòng quanh nó, đừng toast lần nữa (quy ước của app.js:5738).
    expect(err.printed).toBe(true);
    // Khung error vẫn phải được đẩy ra ngoài trước khi ném.
    expect(seen).toContainEqual({ type: 'error', message: 'Appium chưa cài' });
  });

  it('ném ApiRequestError khi request hỏng trước lúc stream mở', async () => {
    server.use(http.post(URL_, () => new Response('{"error":"không có quyền"}', { status: 403 })));
    const err = (await streamJob(URL_, {}, () => {}).catch((e: unknown) => e)) as ApiRequestError;
    expect(err.status).toBe(403);
    expect(err.message).toBe('không có quyền');
    // Lỗi này CHƯA hiện ở đâu cả, nên caller phải tự hiển thị.
    expect(err.printed).toBe(false);
  });

  it('bỏ qua khung hỏng thay vì giết cả stream', async () => {
    server.use(
      http.post(URL_, () => {
        const body = 'event: log\ndata: {khong-phai-json\n\nevent: log\ndata: "ổn"\n\nevent: done\ndata: {"ok":true}\n\n';
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    const got: JobFrame[] = [];
    const result = await streamJob(URL_, {}, (f) => got.push(f));
    expect(got).toContainEqual({ type: 'log', line: 'ổn' });
    expect(result.ok).toBe(true);
  });

  it('huỷ được bằng AbortSignal', async () => {
    server.use(http.post(URL_, () => sse(defaultFrames)));
    const ac = new AbortController();
    ac.abort();
    const onFrame = vi.fn();
    await expect(streamJob(URL_, {}, onFrame, ac.signal)).rejects.toThrow();
    expect(onFrame).not.toHaveBeenCalled();
  });
});

