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

/**
 * Log sinh kịch bản và log chạy test là CÙNG một workflow, người đọc theo dõi
 * nó theo thời gian. Tách làm hai khối cạnh nhau thì phải tự ghép lại trong
 * đầu, và khối cũ — đông cứng ở bước "Chờ duyệt" với vòng quay — trông như vẫn
 * đang chạy trong khi log kia đã báo có report.
 */
describe('Studio — log nối tiếp thành một dòng', () => {
  it('chỉ có MỘT khung log, chứa cả hai giai đoạn', async () => {
    server.use(
      http.post(STREAM_ROUTES.gen, () =>
        sse([
          ['log', 'Sinh bộ testcase…'],
          ['run', { id: 'run-1', status: 'passed', stages: [] }],
          ['done', { ok: true }],
        ]),
      ),
    );
    await start();

    await screen.findByText('Sinh bộ testcase…');
    // Một khung duy nhất, không phải hai khối đặt cạnh nhau.
    expect(screen.getAllByRole('log')).toHaveLength(1);
  });

  /**
   * Id không trùng lượt chạy nào trong state, nên không có nguồn nào khác để
   * rơi về — đúng tình huống "thật sự chưa có bước nào".
   */
  it('không dựng danh sách bước khi không nguồn nào biết bước là gì', async () => {
    server.use(
      http.post(STREAM_ROUTES.gen, () =>
        sse([['log', 'x'], ['run', { id: 'khong-co-trong-state', status: 'passed' }], ['done', { ok: true }]]),
      ),
    );
    await start();

    await screen.findByText('x');
    expect(screen.queryByRole('list', { name: 'Các bước của workflow' })).not.toBeInTheDocument();
  });
});

/**
 * Log tự cuộn xuống đáy trong lúc chạy, nên mắt người đọc ở cuối khung. Đặt kết
 * quả lên đầu thẻ nghĩa là ai không kéo ngược lên thì không biết là đã xong.
 */
describe('Studio — kết cục nằm sau log, không phải trước', () => {
  it('băng kết quả đứng sau khung log trong thứ tự tài liệu', async () => {
    server.use(genEnds('passed'));
    await start();

    const banner = await screen.findByText('Workflow đã hoàn tất');
    const log = screen.getByRole('log');
    // compareDocumentPosition: FOLLOWING nghĩa là banner đứng sau log.
    // eslint-disable-next-line no-console
    console.log('POS=', log.compareDocumentPosition(banner), 'logParent=', log.parentElement?.className);
    expect(log.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * "Xem report" mà mở ra report của lượt chạy KHÁC là kiểu sai khó phát hiện
 * nhất: nó trông y như thật. Xảy ra khi lượt chạy dừng trước lúc kịp ghi report
 * — link không mang id nào, và trang chi tiết rơi về lượt mới nhất.
 */
describe('Studio — chỉ mời xem report khi thật sự có report', () => {
  const endsWith = (run: Record<string, unknown>) =>
    http.post(STREAM_ROUTES.gen, () =>
      sse([['log', 'xong'], ['run', run], ['done', { ok: true }]]),
    );

  it('có report thì link mang đúng id của lượt chạy đó', async () => {
    server.use(
      endsWith({ id: 'wf-1', status: 'passed', stages: [], runDirs: ['2026-09-08T12-00-00Z-web'] }),
    );
    await start();

    const link = await screen.findByRole('link', { name: 'Xem report' });
    expect(link.getAttribute('href')).toContain('runId=2026-09-08T12-00-00Z-web');
  });

  it('không sinh được report thì nói thẳng, không mời bấm', async () => {
    server.use(endsWith({ id: 'wf-1', status: 'failed', stages: [], runDirs: [] }));
    await start();

    expect(await screen.findByText('Lượt chạy này không sinh được report.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Xem report' })).not.toBeInTheDocument();
  });
});
