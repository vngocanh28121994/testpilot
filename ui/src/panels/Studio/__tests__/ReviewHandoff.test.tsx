import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { stateFixture } from '@/test/mocks/fixtures';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
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

describe('Studio — bàn giao sang màn duyệt', () => {
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

/**
 * Workflow chỉ dừng để duyệt khi có kịch bản mới. Còn lại nó chạy thẳng tới hết
 * — và khi đó, trước đây, log đơn giản là ngừng chảy: không ai nói đã xong hay
 * đã hỏng. "Chạy xong thì đứng im" đúng nghĩa đen.
 */
describe('Studio — kết cục của lượt sinh kịch bản', () => {
  it('chạy hết mà không cần duyệt thì nói là đã hoàn tất', async () => {
    server.use(genEnds('passed'));
    await start();
    expect(await screen.findByText('Workflow đã hoàn tất')).toBeInTheDocument();
  });

  it('kết thúc với lỗi thì nói ra, không im', async () => {
    server.use(genEnds('failed'));
    await start();
    expect(await screen.findByText('Workflow kết thúc với lỗi')).toBeInTheDocument();
  });

  /** Hỏng giữa chừng là kết cục cần chú ý nhất, nên không được chỉ nằm ở dòng cuối log. */
  it('luồng gãy giữa chừng thì có băng đỏ, không chỉ một dòng trong log', async () => {
    server.use(
      http.post(STREAM_ROUTES.gen, () =>
        sse([['log', 'đang chạy'], ['error', 'Confluence trả 401'], ['done', { ok: false }]]),
      ),
    );
    await start();
    expect(await screen.findByText('Workflow dừng giữa chừng')).toBeInTheDocument();
    // Xuất hiện hai chỗ là đúng: băng tóm tắt lý do, log giữ nguyên dòng gốc.
    expect(screen.getAllByText(/Confluence trả 401/).length).toBeGreaterThan(0);
  });
});

/**
 * Chỉ chuyển khi luồng VỪA chuyển từ đang-chạy sang xong — không phải hễ thấy
 * nó đang ở trạng thái xong.
 *
 * Effect chạy lại mỗi lần Studio được mount. Bản đầu tiên vì thế đá người dùng
 * ra khỏi Studio mỗi lần họ quay lại — kể cả khi tự bấm vào menu — chừng nào
 * còn một lượt chờ duyệt. Studio thành trang không vào được, và cái vòng
 * "Hoàn thành rồi quay về Studio" thì quay về đúng chỗ cũ.
 */
describe('Studio — không đá người dùng ra khi họ quay lại', () => {
  it('mở Studio trong lúc đang có lượt chờ duyệt thì ở nguyên đó', async () => {
    server.use(
      http.get(ROUTES.state, () =>
        HttpResponse.json({
          ...stateFixture,
          runs: [
            {
              id: 'wf-1',
              status: 'waiting_review',
              startedAt: '2026-09-08T04:00:00.000Z',
              stages: [],
              stagesDone: 0,
              generatedFile: 'chuyen-tien-noi-bo.feature',
              generated: { scenarios: 8 },
            },
          ],
        }),
      ),
    );
    const { router } = await renderWithRouter(<StudioPanel />, { path: '/studio' });

    // Chờ trang dựng xong hẳn để effect nào định chạy thì đã chạy. Mốc chờ là
    // một thứ luôn có ở Studio, không phải một băng có thể bị bỏ đi.
    await screen.findByRole('button', { name: 'Bắt đầu chạy workflow' });
    expect(router.state.location.pathname).toBe('/studio');
  });
});
