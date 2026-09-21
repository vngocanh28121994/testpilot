/**
 * Nút Dừng test nằm ở đầu thẻ "Log chạy", không nằm cạnh nút Chạy test.
 *
 * Trong lúc chạy, log được thêm vào liên tục nên trang dài ra không ngừng và
 * cụm nút chạy bị đẩy khỏi màn hình. Muốn dừng thì phải cuộn ngược lên trong
 * khi nội dung mới vẫn đang đổ xuống dưới — tức đúng lúc cần dừng nhất thì nút
 * dừng là thứ khó với tới nhất.
 *
 * Đặt ở đầu thẻ log thì nó luôn đi cùng thứ người ta đang nhìn.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { useJobStore } from '@/stores/jobStore';
import RunnerPanel from '@/panels/Runner';

const running = (logs: string[]) => useJobStore.setState({
  jobs: {
    'local-run': {
      logs,
      run: null,
      status: 'running',
      error: null,
      dropped: 0,
          lastSeq: 0,
      controller: null,
    },
  },
});

describe('Runner — chỗ đứng của nút Dừng test', () => {
  it('nút Dừng nằm trong thẻ Log chạy', async () => {
    running(['[run:dir] /tmp/runs/2026-09-16T00-00-00Z-web', '[run:running] … Đăng nhập']);
    server.use(http.get(ROUTES.prereqIosNames, () => HttpResponse.json({ names: {} })));

    await renderWithRouter(<RunnerPanel />, { path: '/runner' });

    const logCard = (await screen.findByText('Log chạy')).closest('[data-slot="card"]')!;
    expect(within(logCard as HTMLElement).getByRole('button', { name: /Dừng test/ }))
      .toBeInTheDocument();
  });

  /**
   * Khoảng lặng đầu lượt chạy — lúc driver đang khởi động và chưa có dòng log
   * nào — đúng là lúc người ta hay đổi ý nhất. Thẻ log ẩn đi lúc ấy thì nút
   * Dừng biến mất theo.
   */
  it('thẻ log có mặt ngay cả khi chưa có dòng log nào', async () => {
    running([]);
    server.use(http.get(ROUTES.prereqIosNames, () => HttpResponse.json({ names: {} })));

    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    expect(await screen.findByRole('button', { name: /Dừng test/ })).toBeInTheDocument();
  });

  it('chạy xong thì không còn nút Dừng', async () => {
    useJobStore.setState({
      jobs: {
        'local-run': {
          logs: ['[run:passed] ✓ Đăng nhập thành công'],
          run: null,
          status: 'done',
          error: null,
          dropped: 0,
          lastSeq: 0,
          controller: null,
        },
      },
    });
    server.use(http.get(ROUTES.prereqIosNames, () => HttpResponse.json({ names: {} })));

    await renderWithRouter(<RunnerPanel />, { path: '/runner' });
    await screen.findByText('Log chạy');
    expect(screen.queryByRole('button', { name: /Dừng test/ })).toBeNull();
  });
});
