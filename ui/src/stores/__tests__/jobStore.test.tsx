import { describe, expect, it } from 'vitest';
import { http } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { useJobStore } from '@/stores/jobStore';
import { useStreamJob } from '@/hooks/useStreamJob';

const URL_ = '/api/stream-thu';

function Probe() {
  const job = useStreamJob('j1', URL_);
  return (
    <div>
      <button onClick={() => job.start()}>bắt đầu</button>
      <span data-testid="status">{job.status}</span>
      <span data-testid="count">{job.logs.length}</span>
    </div>
  );
}

describe('jobStore', () => {
  it('gom log và kết thúc ở done', async () => {
    server.use(
      http.post(URL_, () =>
        sse([
          ['log', 'a'],
          ['log', 'b'],
          ['done', { ok: true }],
        ]),
      ),
    );
    await useJobStore.getState().start('j1', URL_);
    const job = useJobStore.getState().jobs['j1'];
    expect(job?.logs).toEqual(['a', 'b']);
    expect(job?.status).toBe('done');
  });

  /**
   * R10 — hồi quy nguy hiểm nhất của cả đợt migrate.
   *
   * Ở app cũ mỗi trang là `<section hidden>`: đổi trang chỉ ẩn đi, không huỷ,
   * nên một farm run 20 phút vẫn chạy tiếp. Với TanStack Router thì `<Outlet/>`
   * UNMOUNT panel — nếu stream do component sở hữu, nó chết giữa chừng và người
   * dùng mất một lần chạy thật trên thiết bị thật.
   *
   * Test này unmount component NGAY trong lúc stream còn bay, rồi khẳng định
   * stream vẫn về đích. Nó sẽ đỏ ngay khi ai đó "dọn dẹp cho gọn" bằng cách
   * thêm `useEffect(() => () => abort(), [])` vào useStreamJob.
   */
  it('stream chạy tiếp sau khi component unmount', async () => {
    server.use(
      http.post(URL_, () =>
        sse(
          [
            ['log', 'một'],
            ['log', 'hai'],
            ['done', { ok: true }],
          ],
          { chunkSize: 8, delayMs: 10 },
        ),
      ),
    );

    const view = render(<Probe />);
    void useJobStore.getState().start('j1', URL_);
    // Còn đang chạy thì đã rút thảm.
    expect(useJobStore.getState().jobs['j1']?.status).toBe('running');
    view.unmount();

    await waitFor(() => expect(useJobStore.getState().jobs['j1']?.status).toBe('done'), {
      timeout: 3000,
    });
    expect(useJobStore.getState().jobs['j1']?.logs).toEqual(['một', 'hai']);
  });

  it('mount lại thì thấy đủ log cũ', async () => {
    server.use(http.post(URL_, () => sse([['log', 'x'], ['done', { ok: true }]])));
    await useJobStore.getState().start('j1', URL_);
    render(<Probe />);
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('status')).toHaveTextContent('done');
  });

  it('không chạy chồng hai stream lên cùng một job', async () => {
    let hits = 0;
    server.use(
      http.post(URL_, () => {
        hits++;
        return sse([['done', { ok: true }]], { delayMs: 20 });
      }),
    );
    const a = useJobStore.getState().start('j1', URL_);
    const b = useJobStore.getState().start('j1', URL_);
    await Promise.all([a, b]);
    expect(hits).toBe(1);
  });

  it('cắt buffer log nhưng đếm số dòng đã bỏ', async () => {
    const many: [string, unknown][] = Array.from({ length: 20 }, (_, i) => ['log', `d${i}`]);
    server.use(http.post(URL_, () => sse([...many, ['done', { ok: true }]])));
    await useJobStore.getState().start('j1', URL_);
    const job = useJobStore.getState().jobs['j1'];
    // Trần thật là 5000; ở đây chỉ khẳng định không mất dòng khi chưa chạm trần.
    expect(job?.logs).toHaveLength(20);
    expect(job?.dropped).toBe(0);
  });

  it('khung error đặt status=error và giữ thông báo', async () => {
    server.use(
      http.post(URL_, () =>
        sse([
          ['log', 'bắt đầu'],
          ['error', 'hỏng rồi'],
          ['done', { ok: false }],
        ]),
      ),
    );
    await useJobStore.getState().start('j1', URL_);
    const job = useJobStore.getState().jobs['j1'];
    expect(job?.status).toBe('error');
    expect(job?.error).toBe('hỏng rồi');
    expect(job?.logs.at(-1)).toContain('hỏng rồi');
  });
});
