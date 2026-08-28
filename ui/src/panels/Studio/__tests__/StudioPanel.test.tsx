import { describe, expect, it } from 'vitest';
import { http } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { renderWithRouter } from '@/test/utils';
import { STREAM_ROUTES } from '@/api/routes';
import StudioPanel from '@/panels/Studio';

/**
 * `/api/gen` kết thúc bằng một khung `run` mang trạng thái workflow cuối cùng.
 * `waiting_review` là tín hiệu "đã sinh xong, giờ tới lượt người".
 */
function genStream(status: string, id = 'wf-42') {
  return sse([
    ['log', 'Đang đọc tài liệu nguồn…'],
    [
      'run',
      {
        id,
        kind: 'workflow',
        feature: 'Đăng nhập',
        status,
        startedAt: '2026-08-27T09:00:00.000Z',
        log: [],
        stages: [{ name: 'Đọc và xác thực tài liệu', status: 'done' }],
        generatedFile: 'dang-nhap.feature',
      },
    ],
    ['done', { ok: true }],
  ]);
}

const start = () => screen.getByRole('button', { name: /Bắt đầu chạy workflow/ });

describe('StudioPanel — nối sang Workflow Gate', () => {
  /**
   * Đây là mắt xích bị đứt trước đợt này: bản React stream xong rồi in log và
   * dừng, không có gì nói phải đi đâu tiếp (app.js:903 thì `navigate` sang
   * `scenario-review:<runId>`).
   */
  it('sinh xong với waiting_review thì dẫn thẳng sang /scenarios kèm runId và file', async () => {
    const user = userEvent.setup();
    server.use(http.post(STREAM_ROUTES.gen, () => genStream('waiting_review')));

    const { router } = await renderWithRouter(<StudioPanel />, { path: '/studio' });
    await screen.findByText('Tài liệu nguồn');
    await user.click(start());

    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'));
    expect(router.state.location.search).toMatchObject({
      runId: 'wf-42',
      file: 'dang-nhap.feature',
    });
  });

  /** Lượt chạy hỏng hoặc chạy thẳng không có gì để duyệt — đá người dùng đi là sai. */
  it('không điều hướng khi workflow kết thúc ở trạng thái khác', async () => {
    const user = userEvent.setup();
    server.use(http.post(STREAM_ROUTES.gen, () => genStream('failed', 'wf-43')));

    const { router } = await renderWithRouter(<StudioPanel />, { path: '/studio' });
    await screen.findByText('Tài liệu nguồn');
    await user.click(start());

    await screen.findByText(/Đang đọc tài liệu nguồn…/);
    expect(router.state.location.pathname).toBe('/studio');
  });

  it('vẽ thanh stage trong lúc chạy', async () => {
    const user = userEvent.setup();
    server.use(http.post(STREAM_ROUTES.gen, () => genStream('failed', 'wf-44')));

    await renderWithRouter(<StudioPanel />, { path: '/studio' });
    await screen.findByText('Tài liệu nguồn');
    await user.click(start());

    // Khung `run` chỉ mang 1 stage; danh sách phải theo server, không phải theo
    // danh sách idle 11 mục.
    const list = await screen.findByRole('list', { name: 'Tiến trình' });
    await waitFor(() => expect(list).toHaveTextContent('Đọc và xác thực tài liệu'));
  });
});
