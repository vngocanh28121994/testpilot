import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { STREAM_ROUTES } from '@/api/routes';
import { sse } from '@/test/mocks/sse';
import StudioPanel from '@/panels/Studio';

/**
 * Dừng để duyệt là một điểm DỪNG có chủ ý, không phải kết thúc.
 *
 * Log nói "Workflow tạm dừng để review 8 testcase… bấm Hoàn thành kịch bản",
 * nhưng cái nút ấy nằm ở màn hình khác. Ở lại Studio thì người dùng đọc xong câu
 * đó rồi ngồi nhìn một khung log không còn chạy nữa, và phải tự suy ra là phải
 * đi đâu.
 */
describe('Studio — bàn giao sang màn duyệt', () => {
  /**
   * Đúng bộ khung mà server thật gửi: log, rồi `run` mang trạng thái mới nhất,
   * rồi `done`. Nhét run vào payload của `done` là kiểu test tự bịa giao thức —
   * store chỉ đọc run từ khung `run`, nên bản đầu tiên của test này đỏ vì chính
   * nó sai, không phải vì component sai.
   */
  const genEnds = (status: string) =>
    http.post(STREAM_ROUTES.gen, () =>
      sse([
        ['log', 'Workflow tạm dừng để review 8 testcase.'],
        ['run', { id: 'run-1', status, stages: [], generatedFile: 'chuyen-tien-noi-bo.feature' }],
        ['done', { ok: true }],
      ]),
    );

  const start = async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(<StudioPanel />, { path: '/studio' });
    await user.click(await screen.findByRole('button', { name: 'Bắt đầu chạy workflow' }));
    return router;
  };

  it('chuyển sang màn duyệt khi workflow dừng chờ review', async () => {
    server.use(genEnds('waiting_review'));
    const router = await start();
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'));
  });

  /**
   * Màn Kịch bản liệt kê MỌI kịch bản của mọi feature — hàng chục cái đã duyệt
   * từ trước. Mở ra mà không lọc thì mấy kịch bản vừa sinh nằm lẫn trong đó, và
   * người duyệt phải tự tìm xem cái nào là cái mới.
   */
  it('lọc sẵn đúng file vừa sinh và chỉ những kịch bản chờ duyệt', async () => {
    server.use(genEnds('waiting_review'));
    const router = await start();
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        file: 'chuyen-tien-noi-bo.feature',
        status: 'pending',
      }),
    );
  });

  /** Dừng chờ trả lời câu hỏi cũng là một lần dừng chờ người, chỉ khác câu hỏi. */
  it('chuyển cả khi workflow dừng chờ trả lời câu hỏi', async () => {
    server.use(genEnds('waiting_input'));
    const router = await start();
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'));
  });

  it('chạy xong xuôi thì KHÔNG chuyển, vì không có gì phải duyệt', async () => {
    server.use(genEnds('passed'));
    const router = await start();
    await waitFor(() => expect(screen.queryByText(/Đang chạy workflow/)).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/studio');
  });
});
