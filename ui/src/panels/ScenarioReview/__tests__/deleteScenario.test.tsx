import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { renderWithRouter } from '@/test/utils';
import ScenarioReviewPanel from '@/panels/ScenarioReview';

/**
 * Xoá kịch bản — master có, v2 thì chưa cho tới giờ.
 *
 * Không có endpoint xoá riêng, và cũng không cần: `PUT /api/feature` đã nhận
 * nội dung đầy đủ kèm `baseRevision`, nên nó từ chối ghi đè khi file đã đổi
 * dưới tay người khác. Một endpoint xoá riêng sẽ phải dựng lại đúng lớp bảo vệ
 * đó.
 */
const rowOf = (name: string) => {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`Không tìm thấy hàng "${name}"`);
  return within(row);
};

const render = () => renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });

let puts: Array<{ filename: string; content: string; baseRevision?: string }>;

beforeEach(() => {
  puts = [];
  server.use(
    http.put(ROUTES.feature, async ({ request }) => {
      puts.push((await request.json()) as (typeof puts)[number]);
      return HttpResponse.json({ ok: true, revision: 'r2' });
    }),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('xoá một kịch bản', () => {
  it('ghi lại file thiếu đúng kịch bản đó', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(rowOf('Đăng nhập thành công').getByRole('button', { name: /Hành động khác/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Xoá kịch bản/ }));

    expect(puts).toHaveLength(1);
    expect(puts[0]!.content).not.toContain('Đăng nhập thành công');
    // Kịch bản khác trong cùng file phải còn nguyên.
    expect(puts[0]!.content).toContain('Sai mật khẩu');
  });

  /** Không hoàn tác được thì phải hỏi. */
  it('hỏi lại trước khi xoá, và không xoá nếu bấm huỷ', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(rowOf('Đăng nhập thành công').getByRole('button', { name: /Hành động khác/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Xoá kịch bản/ }));
    expect(puts).toHaveLength(0);
  });

  /**
   * `baseRevision` phải đi kèm: thiếu nó thì thao tác xoá lặng lẽ ghi đè bản
   * mà workflow vừa sinh ra dưới tay người dùng.
   */
  it('gửi kèm baseRevision để không ghi đè bản mới hơn', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(rowOf('Đăng nhập thành công').getByRole('button', { name: /Hành động khác/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Xoá kịch bản/ }));
    expect(puts[0]!.baseRevision).toBeTruthy();
  });
});

describe('xoá hàng loạt', () => {
  it('gom theo file, ghi MỘT lần cho mỗi file', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(screen.getByRole('checkbox', { name: /Chọn Đăng nhập thành công/ }));
    await user.click(screen.getByRole('checkbox', { name: /Chọn Sai mật khẩu/ }));
    await user.click(screen.getByRole('button', { name: /Xoá đã chọn \(2\)/ }));

    // Hai kịch bản cùng một file: ghi hai lần thì lần sau đè lần trước và một
    // trong hai quay về.
    expect(puts).toHaveLength(1);
    expect(puts[0]!.content).not.toContain('Đăng nhập thành công');
    expect(puts[0]!.content).not.toContain('Sai mật khẩu');
  });
});
