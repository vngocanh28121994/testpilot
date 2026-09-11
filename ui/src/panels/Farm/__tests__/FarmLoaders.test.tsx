import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import FarmPanel from '@/panels/Farm';

/**
 * Ba nút này gọi thẳng sang AWS Device Farm — mất vài giây là chuyện thường.
 * Trước đây chúng bắn đi rồi thôi: không khoá, không đổi nhãn, không nói gì khi
 * xong. Bấm xong màn hình đứng im thì phản xạ tự nhiên là bấm tiếp, và mỗi lần
 * bấm là thêm một lượt gọi API tính tiền.
 */
describe('Farm — nút tải', () => {
  const connected = () =>
    http.get(ROUTES.aws, () =>
      HttpResponse.json({ ok: true, source: '~/.aws', canLogin: true, expiresInMinutes: 400 }),
    );

  it('khoá nút và đổi nhãn trong lúc đang tải', async () => {
    server.use(
      connected(),
      http.get(ROUTES.farmProjects, async () => {
        await delay(300);
        return HttpResponse.json({ ok: true, data: [] });
      }),
    );
    const user = userEvent.setup();
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await user.click(await screen.findByRole('button', { name: 'Tải lại project' }));

    // Trạng thái được đặt TRƯỚC khi gọi mạng, nên nó phải đúng ngay sau cú bấm
    // — không cần chờ, và chờ mới là chỗ test tự làm mình nhấp nháy.
    expect(screen.getByRole('button', { name: 'Đang tải project…' })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tải lại project' })).not.toBeDisabled(),
    );
  });

  /**
   * "0 project" và "chưa bấm" trông giống hệt nhau trên một cái dropdown rỗng,
   * nên kết quả phải được nói ra.
   */
  it('nói ra kết quả, kể cả khi không có gì', async () => {
    server.use(connected(), http.get(ROUTES.farmProjects, () => HttpResponse.json({ ok: true, data: [] })));
    const user = userEvent.setup();
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await user.click(await screen.findByRole('button', { name: 'Tải lại project' }));
    // sonner dựng mỗi toast hai lần (một bản cho trình đọc màn hình), nên hỏi
    // số nhiều thay vì khẳng định chỉ có một.
    expect((await screen.findAllByText('0 project.')).length).toBeGreaterThan(0);
  });

  it('trong lúc tải thì các nút tải khác cũng khoá, không cho gọi chồng lên nhau', async () => {
    server.use(
      connected(),
      http.get(ROUTES.farmProjects, async () => {
        await delay(300);
        return HttpResponse.json({ ok: true, data: [] });
      }),
    );
    const user = userEvent.setup();
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await user.click(await screen.findByRole('button', { name: 'Tải lại project' }));
    expect(screen.getByRole('button', { name: 'Tải thiết bị' })).toBeDisabled();
  });

  it('lỗi thì nói ra và mở khoá nút lại', async () => {
    server.use(
      connected(),
      http.get(ROUTES.farmProjects, () =>
        HttpResponse.json({ ok: false, error: 'Token hết hạn' }, { status: 200 }),
      ),
    );
    const user = userEvent.setup();
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await user.click(await screen.findByRole('button', { name: 'Tải lại project' }));
    expect((await screen.findAllByText('Token hết hạn')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tải lại project' })).not.toBeDisabled(),
    );
  });
});

/**
 * Danh sách project chỉ sống trong state của màn Farm: rời sang màn khác rồi
 * quay lại là rỗng, và người dùng phải bấm "Tải project" mỗi lần vào — trong
 * khi câu trả lời không hề đổi giữa hai lần vào cách nhau vài giây.
 */
describe('Farm — project tự tải', () => {
  /** Cùng một credential dùng được như nhóm trên; tự tải chỉ chạy khi có nó. */
  const connected = () =>
    http.get(ROUTES.aws, () =>
      HttpResponse.json({ ok: true, source: '~/.aws', canLogin: true, expiresInMinutes: 400 }),
    );

  it('có credential dùng được thì tự tải, không phải bấm', async () => {
    let calls = 0;
    server.use(
      connected(),
      http.get(ROUTES.farmProjects, () => {
        calls += 1;
        return HttpResponse.json({
          ok: true,
          data: [{ arn: 'arn:p1', name: 'TCInvest' }],
        });
      }),
    );
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await waitFor(() => expect(calls).toBe(1));
  });

  /** Lần tự tải thì im: người dùng không bấm gì thì không cần báo kết quả. */
  it('tự tải xong không bắn toast', async () => {
    server.use(
      connected(),
      http.get(ROUTES.farmProjects, () =>
        HttpResponse.json({ ok: true, data: [{ arn: 'arn:p1', name: 'TCInvest' }] }),
      ),
    );
    await renderWithRouter(<FarmPanel />, { path: '/farm' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tải lại project' })).not.toBeDisabled(),
    );
    expect(screen.queryByText('1 project.')).not.toBeInTheDocument();
  });
});
