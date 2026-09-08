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

    expect(await screen.findByText('Token hết hạn')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Đăng nhập AWS' }));

    await waitFor(() => expect(screen.queryByText('Token hết hạn')).not.toBeInTheDocument());
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
