import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { WorkflowPreflight } from '../WorkflowPreflight';

/**
 * Bảng này là thứ dễ mất nhất khi chuyển sang giao diện mới: bỏ nó đi thì trang
 * vẫn chạy, vẫn lưu được, chỉ là người dùng tick Android xong không biết máy đã
 * cắm chưa — và biết điều đó nửa tiếng sau, lúc workflow đã gọi model hai lần.
 * Bản React đầu tiên đúng là đã thiếu nó.
 */
describe('WorkflowPreflight', () => {
  it('không nói gì khi chỉ chạy web', () => {
    renderWithProviders(<WorkflowPreflight platforms={[]} devices={{}} onPick={vi.fn()} />);
    expect(screen.queryByLabelText('Kiểm tra môi trường')).not.toBeInTheDocument();
  });

  it('hiện kết luận và từng mục kiểm tra của nền tảng đã tick', async () => {
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{}} onPick={vi.fn()} />,
    );
    expect(await screen.findByText(/Android — sẵn sàng/)).toBeInTheDocument();
    // Tên nằm trong <b>, chi tiết là text node bên cạnh — getByText chỉ đọc
    // text con trực tiếp nên phải hỏi riêng từng phần.
    expect(screen.getByText('Thiết bị:')).toBeInTheDocument();
    expect(screen.getByText(/pixel-7 \(emulator-5554\)/)).toBeInTheDocument();
  });

  it('nói "chưa chạy được" và nêu lý do khi môi trường chưa đủ', async () => {
    server.use(
      http.get(ROUTES.preflight, () =>
        HttpResponse.json({
          platform: 'android',
          ok: false,
          checks: [{ name: 'Appium', ok: false, detail: 'Không có gì lắng nghe ở cổng 4723.' }],
        }),
      ),
    );
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{}} onPick={vi.fn()} />,
    );
    expect(await screen.findByText(/Android — chưa chạy được/)).toBeInTheDocument();
    expect(screen.getByText('Không có gì lắng nghe ở cổng 4723.')).toBeInTheDocument();
  });

  /**
   * Lỗi mạng phải hiện ra, không được biến thành khoảng trống: một bảng rỗng
   * đọc y như "mọi thứ ổn", đúng lúc không có gì ổn cả.
   */
  it('hiện lỗi khi không hỏi được', async () => {
    server.use(http.get(ROUTES.preflight, () => HttpResponse.json({ error: 'adb chết' }, { status: 500 })));
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{}} onPick={vi.fn()} />,
    );
    expect(await screen.findByText(/Android — chưa chạy được/)).toBeInTheDocument();
  });

  it('chỉ hỏi chọn máy khi có nhiều hơn một máy đang cắm', async () => {
    server.use(
      http.get(ROUTES.preflight, () =>
        HttpResponse.json({
          platform: 'android',
          ok: false,
          checks: [{ name: 'Thiết bị', ok: false, detail: 'Hai máy đang cắm.' }],
          candidates: [
            { id: 'pixel', label: 'pixel (emulator-5554)' },
            { id: 'samsung', label: 'samsung (R5CT10)' },
          ],
        }),
      ),
    );
    const onPick = vi.fn();
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{}} onPick={onPick} />,
    );
    const choice = await screen.findByRole('radio', { name: 'samsung (R5CT10)' });
    await userEvent.click(choice);
    expect(onPick).toHaveBeenCalledWith('android', 'samsung');
  });

  /**
   * Máy đã chọn phải đi kèm lần dò kế tiếp: server đọc config đã lưu, mà lựa
   * chọn vừa bấm một giây trước thì chưa nằm trong đó. Thiếu tham số này thì
   * bảng vẫn đỏ mãi dù câu hỏi đã được trả lời.
   */
  it('gửi máy đã chọn kèm theo lần dò', async () => {
    const asked: string[] = [];
    server.use(
      http.get(ROUTES.preflight, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('device') ?? '');
        return HttpResponse.json({ platform: 'android', ok: true, checks: [] });
      }),
    );
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{ android: 'samsung' }} onPick={vi.fn()} />,
    );
    await waitFor(() => expect(asked).toEqual(['samsung']));
  });
});
