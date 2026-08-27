import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { healingFixture } from '@/test/mocks/fixtures';
import { ROUTES } from '@/api/routes';
import HealingPanel from '@/panels/Healing';

const rows = () => screen.getAllByRole('row').slice(1); // bỏ hàng tiêu đề

describe('HealingPanel', () => {
  it('hiện tổng hợp và câu policy', async () => {
    await renderWithRouter(<HealingPanel />);
    await screen.findByText('login.submit');
    expect(screen.getByText('Đề xuất khi ≥ 3 lần heal qua ≥ 2 run')).toBeInTheDocument();

    // 4 ô thống kê. Phải soi trong nhóm: "Chờ duyệt" còn xuất hiện ở option
    // của bộ lọc và ở pill trạng thái trong bảng.
    const stats = within(screen.getByRole('group', { name: 'Tổng hợp healing' }));
    const expected: [label: string, value: string][] = [
      ['Chờ duyệt', '2'],
      ['Đang theo dõi', '1'],
      ['Đã áp dụng', '1'],
      ['Đã từ chối', '0'],
    ];
    for (const [label, value] of expected) {
      expect(stats.getByText(label).previousSibling).toHaveTextContent(value);
    }
  });

  it('lọc theo trạng thái và platform, AND với nhau', async () => {
    const user = userEvent.setup();
    await renderWithRouter(<HealingPanel />);
    await screen.findByText('login.submit');
    expect(rows()).toHaveLength(4);

    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'proposed');
    expect(rows()).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('Platform'), 'android');
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('cart.total')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Platform'), 'web');
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('login.submit')).toBeInTheDocument();
  });

  it('báo rỗng khi bộ lọc không khớp gì', async () => {
    const user = userEvent.setup();
    await renderWithRouter(<HealingPanel />);
    await screen.findByText('login.submit');
    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'rejected');
    expect(screen.getByText('Không có healing record khớp bộ lọc.')).toBeInTheDocument();
  });

  /**
   * Quality gate. Nút bị khoá phải NÓI RA lý do: một nút xám im lặng để lại
   * người duyệt không biết phải làm gì tiếp (app.js:1130).
   */
  it('khoá nút Áp dụng khi chưa đạt quality gate và nêu lý do', async () => {
    await renderWithRouter(<HealingPanel />);
    const row = (await screen.findByText('cart.total')).closest('tr')!;
    const apply = within(row).getByRole('button', { name: 'Áp dụng' });
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute('title', 'Chưa đạt quality gate: xpath theo vị trí, không có testId');
    // Từ chối thì luôn được — từ chối không ghi gì vào registry.
    expect(within(row).getByRole('button', { name: 'Từ chối' })).toBeEnabled();
  });

  it('chỉ bản ghi ở trạng thái proposed mới có nút hành động', async () => {
    await renderWithRouter(<HealingPanel />);
    const applied = (await screen.findByText('nav.logout')).closest('tr')!;
    expect(within(applied).queryByRole('button')).toBeNull();
  });

  /**
   * Xác nhận hai bước. Áp dụng ghi thẳng vào element registry và không có nút
   * hoàn tác, nên một cú bấm nhầm không được phép đủ để gây hậu quả.
   */
  it('cần xác nhận hai bước rồi mới gọi API', async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      http.post(ROUTES.healingReview, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...healingFixture,
          summary: { ...healingFixture.summary, proposed: 1, applied: 2 },
        });
      }),
    );

    await renderWithRouter(<HealingPanel />);
    const row = (await screen.findByText('login.submit')).closest('tr')!;

    await user.click(within(row).getByRole('button', { name: 'Áp dụng' }));
    // Bước một chưa được gọi API.
    expect(body).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Xác nhận áp dụng' }));

    await waitFor(() => expect(body).toEqual({ id: 'h1', action: 'apply' }));
  });

  it('huỷ ở bước hai thì không gọi API và quay lại nút ban đầu', async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(
      http.post(ROUTES.healingReview, () => {
        called = true;
        return HttpResponse.json(healingFixture);
      }),
    );

    await renderWithRouter(<HealingPanel />);
    const row = (await screen.findByText('login.submit')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Từ chối' }));
    await user.click(within(row).getByRole('button', { name: 'Huỷ' }));

    expect(called).toBe(false);
    expect(within(row).getByRole('button', { name: 'Áp dụng' })).toBeInTheDocument();
  });

  it('hiện lỗi khi tải hỏng', async () => {
    server.use(http.get(ROUTES.healing, () => HttpResponse.json({ error: 'ổ đĩa hỏng' }, { status: 500 })));
    await renderWithRouter(<HealingPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ổ đĩa hỏng');
  });
});
