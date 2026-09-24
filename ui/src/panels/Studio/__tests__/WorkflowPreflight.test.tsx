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

  /**
   * Danh sách máy tới từ SỔ MÁY, không từ phép dò của máy chủ: máy cắm ở
   * laptop người khác cũng phải hiện ra để chọn, vì workflow nay chạy được
   * trên chúng qua hàng đợi job.
   */
  it('chỉ hỏi chọn máy khi có nhiều hơn một máy, và gọi theo udid', async () => {
    server.use(
      http.get(ROUTES.preflight, () =>
        HttpResponse.json({ platform: 'android', ok: false, checks: [] })),
      http.get(ROUTES.deviceTargets, () => HttpResponse.json({
        devices: [
          { platform: 'android', udid: 'emulator-5554', label: 'pixel', runnerName: 'máy chủ' },
          { platform: 'android', udid: 'R5CT10', label: 'samsung', runnerName: 'laptop của Bình' },
        ],
      })),
    );
    const onPick = vi.fn();
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{}} onPick={onPick} />,
    );
    const choice = await screen.findByRole('radio', { name: 'samsung' });
    // Nhóm theo máy tính, giống Local Runner.
    expect(screen.getByText('laptop của Bình')).toBeInTheDocument();
    await userEvent.click(choice);
    expect(onPick).toHaveBeenCalledWith('android', 'R5CT10');
  });

  /**
   * Một máy duy nhất thì không có gì để hỏi — nhưng lựa chọn phải được GHI,
   * vì workflow đọc đúng lựa chọn ấy. Bản trước không chọn gì, nên máy chủ tự
   * dò `adb` của chính nó và báo "Chưa có máy nào kết nối" trong khi chiếc máy
   * duy nhất đang cắm ở laptop khác, sẵn sàng.
   */
  it('một máy đang chạy duy nhất thì tự chọn và ghi lại', async () => {
    server.use(
      http.get(ROUTES.preflight, () =>
        HttpResponse.json({ platform: 'android', ok: true, checks: [] })),
      http.get(ROUTES.deviceTargets, () => HttpResponse.json({
        devices: [
          { platform: 'android', udid: 'R5CT10', label: 'samsung', runnerName: 'laptop của Bình' },
          // Máy đang tắt không được tính: tự chọn một chiếc máy đã tắt là
          // đưa workflow tới một cú dừng chắc chắn.
          { platform: 'android', udid: 'OLD1', label: 'cũ · đang tắt', offline: true },
        ],
      })),
    );
    const onPick = vi.fn();
    renderWithProviders(
      <WorkflowPreflight platforms={['android']} devices={{}} onPick={onPick} />,
    );
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith('android', 'R5CT10'));
  });

  it('gửi nguồn app kèm lần dò', async () => {
    // Với máy ở runner khác, "bản đã tải lên" chưa gửi sang được — màn hình
    // phải nói điều đó trước khi bấm chạy, và nó chỉ nói được khi biết.
    const asked: string[] = [];
    server.use(
      http.get(ROUTES.preflight, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json({ platform: 'android', ok: true, checks: [] });
      }),
    );
    renderWithProviders(
      <WorkflowPreflight
        platforms={['android']} devices={{ android: 'R5CT10' }} onPick={vi.fn()} appSource="upload"
      />,
    );
    await vi.waitFor(() => expect(asked.some((q) => q.includes('appSource=upload'))).toBe(true));
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
