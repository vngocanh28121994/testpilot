import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { ROUTES } from '@/api/routes';
import ScenarioReviewPanel from '@/panels/ScenarioReview';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';

describe('ScenarioReviewPanel — Known Issue', () => {
  it('thu thập lý do trong dialog của app và gửi đúng kịch bản', async () => {
    const requests: unknown[] = [];
    server.use(
      http.post(ROUTES.featureKnownIssue, async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );

    // `delay: null` bỏ nhịp chờ giữa các phím. Lý do gõ 29 ký tự lại thành vấn
    // đề: mỗi phím là một vòng chờ timer, và khi cả suite chạy song song thì
    // riêng phần gõ đủ để vượt hạn 5 giây — ca này chạy 1,2 giây khi đứng một
    // mình nhưng timeout trong suite đầy đủ. Ngữ nghĩa sự kiện giữ nguyên, vẫn
    // là từng phím một, nên khẳng định "nút bật lên sau khi có chữ" không đổi.
    const user = userEvent.setup({ delay: null });
    await renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });
    const scenario = await screen.findByText('Đăng nhập thành công');
    const row = scenario.closest('tr');
    if (!row) throw new Error('Không tìm thấy hàng kịch bản');

    await user.click(within(row).getByRole('button', { name: /Hành động khác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đánh dấu Known issue' }));

    const dialog = await screen.findByRole('dialog', { name: 'Đánh dấu Known Issue' });
    expect(within(dialog).getByText('Đăng nhập thành công')).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Đánh dấu Known Issue' });
    expect(submit).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText('Lý do sản phẩm chưa đáp ứng'),
      'API chưa trả về danh mục đích.',
    );
    await user.click(submit);

    expect(requests).toEqual([
      {
        scenarioId: 'dang-nhap-thanh-cong',
        note: 'API chưa trả về danh mục đích.',
      },
    ]);
    expect(screen.queryByRole('dialog', { name: 'Đánh dấu Known Issue' })).not.toBeInTheDocument();
  });
});
