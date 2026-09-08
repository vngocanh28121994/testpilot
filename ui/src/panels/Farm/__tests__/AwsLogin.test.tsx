import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { sse } from '@/test/mocks/sse';
import FarmPanel from '@/panels/Farm';

/**
 * Cả điểm của việc đăng nhập là cái TRẠNG THÁI sau đó.
 *
 * Trạng thái kết nối chỉ được hỏi khi đổi region, nên sau một lần `aws sso
 * login` thành công màn hình vẫn y nguyên: log nói "Successfully logged into
 * Start URL" trong khi huy hiệu bên trên vẫn là trạng thái cũ, và người dùng
 * phải tự đoán ra là phải bấm "Kiểm tra lại".
 */
describe('Farm — đăng nhập AWS', () => {
  /** Lần hỏi đầu: chưa kết nối. Từ lần thứ hai: đã kết nối. */
  function awsFlipsAfterLogin() {
    let asked = 0;
    return [
      http.get(ROUTES.aws, () => {
        asked += 1;
        return HttpResponse.json(
          asked === 1
            ? { ok: false, source: '~/.aws', reason: 'Token hết hạn', canLogin: true }
            : { ok: true, source: '~/.aws', canLogin: true },
        );
      }),
      http.post(STREAM_ROUTES.awsLogin, () =>
        sse([['log', 'Successfully logged into Start URL'], ['done', { ok: true }]]),
      ),
    ];
  }

  it('kiểm tra lại trạng thái ngay sau khi đăng nhập xong', async () => {
    server.use(...awsFlipsAfterLogin());
    const user = userEvent.setup();
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    expect(await screen.findByText(/Token hết hạn/)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Đăng nhập AWS' }));

    await waitFor(() => expect(screen.queryByText(/Token hết hạn/)).not.toBeInTheDocument());
  });

  it('khoá nút trong lúc đang đăng nhập, để không bấm hai lần', async () => {
    server.use(...awsFlipsAfterLogin());
    const user = userEvent.setup();
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await user.click(await screen.findByRole('button', { name: 'Đăng nhập AWS' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Đăng nhập AWS' })).not.toBeDisabled(),
    );
  });
});

/**
 * "Đăng nhập xong mà không thấy gì thay đổi" — vì khi đã kết nối được từ trước,
 * huy hiệu vẫn xanh trước và sau. Thứ DUY NHẤT thật sự đổi là hạn của credential,
 * mà màn hình lại không hiển thị nó.
 */
describe('Farm — hạn của credential', () => {
  const withStatus = (extra: Record<string, unknown>) =>
    http.get(ROUTES.aws, () =>
      HttpResponse.json({ ok: true, source: '~/.aws', canLogin: true, ...extra }),
    );

  it('nói còn bao lâu, không chỉ nói "kết nối được"', async () => {
    server.use(withStatus({ keyHint: 'ASIA', expiresInMinutes: 405 }));
    await renderWithRouter(<FarmPanel />, { path: '/farm' });
    expect(await screen.findByText(/còn 6 giờ 45 phút/)).toBeInTheDocument();
    expect(screen.getByText(/key ASIA…/)).toBeInTheDocument();
  });

  it('dưới 90 phút thì nói theo phút, cho khỏi phải tự chia', async () => {
    server.use(withStatus({ expiresInMinutes: 42 }));
    await renderWithRouter(<FarmPanel />, { path: '/farm' });
    expect(await screen.findByText(/còn 42 phút/)).toBeInTheDocument();
  });

  /**
   * Sắp hết hạn là trạng thái riêng: 15 phút là mức mà một lượt chạy farm nhiều
   * khả năng sống lâu hơn chính credential của nó.
   */
  it('cảnh báo khi sắp hết hạn, thay vì vẫn báo xanh', async () => {
    server.use(withStatus({ expiresInMinutes: 9 }));
    await renderWithRouter(<FarmPanel />, { path: '/farm' });
    expect(await screen.findByText('Sắp hết hạn')).toBeInTheDocument();
    expect(screen.queryByText('Kết nối được')).not.toBeInTheDocument();
  });

  it('credential không hết hạn thì nói rõ, không để trống', async () => {
    server.use(withStatus({}));
    await renderWithRouter(<FarmPanel />, { path: '/farm' });
    expect(await screen.findByText(/không hết hạn \(IAM role hoặc access key\)/)).toBeInTheDocument();
  });

  it('đã hết hạn thì nói đã hết hạn, không hiện số âm', async () => {
    server.use(withStatus({ expiresInMinutes: -30 }));
    await renderWithRouter(<FarmPanel />, { path: '/farm' });
    expect(await screen.findByText(/đã hết hạn/)).toBeInTheDocument();
  });
});
