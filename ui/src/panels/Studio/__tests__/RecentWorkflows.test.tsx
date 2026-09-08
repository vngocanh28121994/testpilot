import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '@/test/mocks/fixtures';
import { RecentWorkflows } from '../RecentWorkflows';

/**
 * Bản React có sẵn một trang lịch sử workflow đầy đủ nhưng KHÔNG có lối nào dẫn
 * tới: không mục menu, không link — cách duy nhất vào là gõ URL. Bản cũ đặt bảng
 * này ngay trong trang App Studio, và đúng: người ta mở Studio để chạy workflow,
 * nên "lần trước chạy ra sao" thuộc về đúng chỗ đó.
 */
const run = (over: Record<string, unknown> = {}) => ({
  id: 'wf-1',
  kind: 'workflow',
  feature: 'Chuyển tiền nội bộ',
  status: 'passed',
  startedAt: '2026-09-08T04:00:00.000Z',
  stages: [{ name: 'a', status: 'done' }, { name: 'b', status: 'done' }],
  stagesDone: 2,
  generatedFile: 'chuyen-tien-noi-bo.feature',
  ...over,
});

const render = async (runs: unknown[]) => {
  server.use(http.get(ROUTES.state, () => HttpResponse.json({ ...stateFixture, runs })));
  return renderWithRouter(<RecentWorkflows />, { path: '/studio' });
};

describe('Lịch sử workflow gần đây', () => {
  it('liệt kê lượt chạy kèm chức năng, thời gian, trạng thái và số bước', async () => {
    await render([run()]);
    expect(await screen.findByText('Chuyển tiền nội bộ')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('bấm một lượt đã xong thì mở trang lịch sử tại đúng lượt đó', async () => {
    const user = userEvent.setup();
    const { router } = await render([run()]);

    await user.click(await screen.findByRole('button', { name: /Mở lượt chạy Chuyển tiền nội bộ/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios/history'));
    expect(router.state.location.search).toMatchObject({ focusId: 'wf-1' });
  });

  /**
   * Lượt đang chờ người thì việc phải làm nằm ở màn duyệt, không phải ở trang
   * lịch sử — bản cũ ghi rõ: đưa một lượt chờ-trả-lời vào lịch sử là đặt câu hỏi
   * ở chỗ người vận hành không có lý do gì để nhìn vào.
   */
  it('bấm một lượt đang chờ duyệt thì mở màn duyệt, lọc sẵn file của nó', async () => {
    const user = userEvent.setup();
    const { router } = await render([run({ status: 'waiting_review' })]);

    await user.click(await screen.findByRole('button', { name: /Mở lượt chạy/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'));
    expect(router.state.location.search).toMatchObject({
      file: 'chuyen-tien-noi-bo.feature',
      status: 'pending',
    });
  });

  it('không có lượt nào thì không chiếm chỗ', async () => {
    await render([]);
    // `container` gồm cả vỏ router nên không bao giờ rỗng — hỏi thẳng cái thẻ.
    await waitFor(() =>
      expect(screen.queryByText('Lịch sử workflow gần đây')).not.toBeInTheDocument(),
    );
  });

  it('lượt chạy farm không lẫn vào đây', async () => {
    await render([run({ kind: 'farm', feature: 'Chạy trên farm' })]);
    await waitFor(() => expect(screen.queryByText('Chạy trên farm')).not.toBeInTheDocument());
  });
});
