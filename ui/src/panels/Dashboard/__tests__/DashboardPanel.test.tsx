import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import DashboardPanel from '@/panels/Dashboard';

describe('DashboardPanel', () => {
  it('hiện 5 ô số đúng như bản cũ', async () => {
    await renderWithRouter(<DashboardPanel />);
    // Chờ một GIÁ TRỊ, không phải một nhãn. Ô số theo khuôn sen hiện nhãn ngay
    // từ lúc đang tải (chỉ con số là skeleton) để khung không nhảy, nên nhãn
    // xuất hiện trước khi /api/state trả về và không dùng làm mốc chờ được nữa.
    await screen.findByText('106');
    const tiles = within(screen.getByRole('group', { name: 'Tổng quan' }));

    const expected: [label: string, value: string][] = [
      ['feature file', '2'],
      ['scenario', '2'], // 2 + 0: file hỏng không đóng góp scenario nào
      ['element', '106'],
      ['lần chạy', '3'],
      ['lần thất bại', '2'],
    ];
    // Soi trong từng ô chứ không dùng previousSibling: khuôn ô số theo
    // sen/frontend đặt NHÃN lên trên và SỐ xuống dưới, nên quan hệ anh-em đảo
    // chiều. Thứ cần khoá là "nhãn nào đi với số nào", không phải thứ tự DOM.
    for (const [label, value] of expected) {
      const tile = tiles.getByText(label).closest<HTMLElement>('[data-slot="stat-tile"]');
      expect(tile).not.toBeNull();
      expect(within(tile!).getByText(value)).toBeInTheDocument();
    }
  });

  it('liệt kê feature, cộng đúng số scenario và step', async () => {
    await renderWithRouter(<DashboardPanel />);
    const row = (await screen.findByText('dang-nhap.feature')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Đăng nhập');
    expect(cells[2]).toHaveTextContent('2');
    expect(cells[3]).toHaveTextContent('7'); // 4 + 3
  });

  /**
   * File không parse được VẪN phải hiện, kèm lỗi. Bỏ qua nó là cách chắc chắn
   * nhất để một feature hỏng nằm im hàng tuần (server.ts:1067).
   */
  it('hiện file hỏng kèm thông báo lỗi thay cho tên feature', async () => {
    await renderWithRouter(<DashboardPanel />);
    const row = (await screen.findByText('chuyen-tien.feature')).closest('tr')!;
    expect(within(row).getByText(/Không bind được element/)).toBeInTheDocument();
    expect(within(row).getByText(/⚠/)).toBeInTheDocument();
  });

  it('báo rỗng khi chưa sinh feature nào', async () => {
    server.use(
      http.get(ROUTES.state, async () => {
        const { stateFixture } = await import('@/test/mocks/fixtures');
        return HttpResponse.json({ ...stateFixture, features: [] });
      }),
    );
    await renderWithRouter(<DashboardPanel />);
    expect(await screen.findByText('Chưa sinh feature nào.')).toBeInTheDocument();
  });

  it('hiện lỗi khi /api/state hỏng', async () => {
    server.use(http.get(ROUTES.state, () => HttpResponse.json({ error: 'config hỏng' }, { status: 500 })));
    await renderWithRouter(<DashboardPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('config hỏng');
  });
});
