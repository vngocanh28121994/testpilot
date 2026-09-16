/**
 * Element trùng vai được duyệt ở đây, không phải trong log của `run`.
 *
 * Không chỉ là chuyện chỗ để. Một dòng cảnh báo in lại mỗi lượt chạy thì
 * không đổi gì giữa hai lượt và sẽ bị lướt qua trong một ngày; ở đây có thứ
 * mà cảnh báo không có — một quyết định được ghi nhớ, nên danh sách về được 0.
 * Trong bốn cặp đo được trên registry thật có ít nhất một cặp gần như chắc
 * chắn là cố ý (cùng một trường trên màn nhập và màn xác nhận chuyển tiền), và
 * một danh sách không bao giờ sạch sẽ kéo cả phần đúng xuống cùng.
 */
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { duplicateFixture, healingFixture } from '@/test/mocks/fixtures';
import { ROUTES } from '@/api/routes';
import HealingPanel from '@/panels/Healing';

const withDuplicates = (over: Partial<(typeof duplicateFixture)[number]> = {}) =>
  server.use(
    http.get(ROUTES.healing, () => HttpResponse.json({
      ...healingFixture,
      duplicates: [{ ...duplicateFixture[0]!, ...over }],
    })),
  );

/** Bảng trùng vai nằm sau tab; mọi test phải mở tab ấy trước. */
async function openDuplicatesTab() {
  await renderWithRouter(<HealingPanel />);
  await screen.findByText('login.submit');
  await userEvent.click(screen.getByRole('tab', { name: /Element trùng vai/ }));
}

describe('Element trùng vai trong Healing Center', () => {
  /**
   * Hai bảng, hai tab. Trùng vai là phát hiện bảo trì registry, còn bản ghi
   * healing là chuyện locator qua các lượt chạy — xếp chồng thì số cặp tăng
   * theo số feature được soạn, và mười cặp đủ đẩy bảng healing khỏi màn hình.
   */
  it('hai bảng nằm ở hai tab, mỗi tab nói sẵn bên mình có bao nhiêu', async () => {
    withDuplicates();
    await renderWithRouter(<HealingPanel />);

    // Chờ dữ liệu về đã: tab render ngay từ đầu, còn con số thì đến sau.
    await screen.findByText('login.submit');
    const duplicatesTab = screen.getByRole('tab', { name: /Element trùng vai/ });
    expect(within(duplicatesTab).getByText('1')).toBeInTheDocument();
    // Tab healing mở sẵn, nên bảng trùng vai chưa chiếm chỗ nào.
    expect(screen.queryByText('label:Xoá khỏi danh mục')).toBeNull();

    await userEvent.click(duplicatesTab);
    expect(await screen.findByText('label:Xoá khỏi danh mục')).toBeInTheDocument();
  });

  it('nêu đủ bằng chứng để người duyệt tự kết luận', async () => {
    withDuplicates();
    await openDuplicatesTab();
    expect(await screen.findByText('label:Xoá khỏi danh mục')).toBeInTheDocument();
    expect(screen.getByText('priceBoard.xoaKhoiDanhMuc')).toBeInTheDocument();
    // Hai tỉ lệ cạnh nhau, vì đó là con số người duyệt so sánh với nhau:
    // 100% với 100% là một control, còn 40% với 100% thì đáng ngờ.
    expect(screen.getByText('100% / 100%')).toBeInTheDocument();
  });

  /**
   * Xác nhận hai bước, cùng lý do với nút Áp dụng của bảng healing: nó ghi
   * thẳng vào element registry và không có nút hoàn tác.
   */
  it('cần xác nhận hai bước rồi mới ghi vào registry', async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    withDuplicates();
    server.use(
      http.post(ROUTES.healingDuplicate, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(healingFixture);
      }),
    );

    await openDuplicatesTab();
    await user.click(await screen.findByRole('button', { name: 'Dùng chung locator' }));
    expect(body).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Xác nhận dùng chung' }));

    await waitFor(() => expect(body).toEqual({
      strong: 'priceBoard.xoaKhoiDanhMuc',
      weak: 'stockOptionsMenu.removeFromCategory',
      action: 'merge',
    }));
  });

  /** "Không phải trùng" chỉ ghi một quyết định, nên không cần hai bước. */
  it('"không phải trùng" là quyết định được ghi, không phải một lần bỏ qua', async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    withDuplicates();
    server.use(
      http.post(ROUTES.healingDuplicate, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(healingFixture);
      }),
    );

    await openDuplicatesTab();
    await user.click(await screen.findByRole('button', { name: 'Không phải trùng' }));
    await waitFor(() => expect(body).toEqual({
      strong: 'priceBoard.xoaKhoiDanhMuc',
      weak: 'stockOptionsMenu.removeFromCategory',
      action: 'distinct',
    }));
  });

  /** Bấm một nút không đổi gì là cách nhanh nhất làm người ta mất tin vào nút. */
  it('khoá nút dùng chung khi bên yếu đã có sẵn locator ấy', async () => {
    withDuplicates({ weakAlreadyHasIt: true });
    await openDuplicatesTab();
    expect(await screen.findByRole('button', { name: 'Dùng chung locator' })).toBeDisabled();
  });

  /**
   * Danh sách rỗng là một câu trả lời, không phải một khoảng trống. Tab vẫn
   * còn đó với số 0 — thứ nói rằng cơ chế có chạy và hiện không có gì phải
   * xử lý, khác hẳn với việc nó im lặng vì hỏng.
   */
  it('không có cặp nào thì nói ra là đã sạch', async () => {
    await renderWithRouter(<HealingPanel />);
    await screen.findByText('login.submit');
    const tab = screen.getByRole('tab', { name: /Element trùng vai/ });
    expect(within(tab).getByText('0')).toBeInTheDocument();
    await userEvent.click(tab);
    expect(await screen.findByText(/Không có cặp nào đang chờ/)).toBeInTheDocument();
  });
});
