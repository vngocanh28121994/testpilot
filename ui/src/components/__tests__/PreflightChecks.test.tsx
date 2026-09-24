import { describe, expect, it } from 'vitest';
import { http } from 'msw';
import { server } from '@/test/mocks/server';
import { sse } from '@/test/mocks/sse';
import { STREAM_ROUTES } from '@/api/routes';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { useJobStore } from '@/stores/jobStore';
import { PreflightChecks } from '../PreflightChecks';
import type { PreflightCheck } from '@core/ui/contracts.js';

const APPIUM_DOWN: PreflightCheck = {
  name: 'Appium server',
  ok: false,
  fix: 'appium',
  detail: 'Chưa chạy ở 127.0.0.1:4723.',
};

const DEVICE_DOWN: PreflightCheck = {
  name: 'Thiết bị Android',
  ok: false,
  detail: 'Chưa có máy nào kết nối.',
};

describe('PreflightChecks', () => {
  /**
   * Bảo người dùng "chạy `appium` ở một terminal khác" trong khi chính công cụ
   * bật được Appium là đẩy sang cho họ một việc mình làm được — ngay tại màn
   * hình đã biết chính xác thứ đang thiếu là gì.
   */
  it('mời bật Appium ngay tại dòng báo Appium chưa chạy', async () => {
    renderWithProviders(<PreflightChecks checks={[APPIUM_DOWN]} />);
    expect(screen.getByRole('button', { name: 'Khởi động Appium' })).toBeInTheDocument();
  });

  it('không mời làm gì với mục mà công cụ không tự chữa được', () => {
    renderWithProviders(<PreflightChecks checks={[DEVICE_DOWN]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('không mời bật lại khi Appium đang chạy', () => {
    renderWithProviders(
      <PreflightChecks
        checks={[{ name: 'Appium server', ok: true, fix: 'appium', detail: 'Đang chạy.' }]}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * Khẳng định vào kết quả, không vào trạng thái thoáng qua: luồng khởi động
   * trong test chạy xong gần như tức thì, nên bắt cho được nhãn "đang chạy" là
   * đua với chính nó — đỏ ngẫu nhiên tuỳ máy nhanh chậm.
   */
  it('bấm là thật sự chạy luồng khởi động Appium', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreflightChecks checks={[APPIUM_DOWN]} />);

    await user.click(screen.getByRole('button', { name: 'Khởi động Appium' }));

    await waitFor(() =>
      expect(useJobStore.getState().jobs['preflight-fix-start_appium']?.status).toBe('done'),
    );
  });

  it('nói ra lỗi khi khởi động hỏng, không im lặng', async () => {
    renderWithProviders(<PreflightChecks checks={[APPIUM_DOWN]} />);
    useJobStore.setState((state) => ({
      jobs: {
        ...state.jobs,
        'preflight-fix-start_appium': {
          logs: [],
          run: null,
          status: 'error',
          error: 'Cổng 4723 đang bị chiếm.',
          dropped: 0,
          lastSeq: 0,
          controller: null,
        },
      },
    }));
    expect(await screen.findByText('Cổng 4723 đang bị chiếm.')).toBeInTheDocument();
  });

  /**
   * Nút sửa nói TRƯỚC là việc sẽ làm trên máy nào. Trước đây người ngồi ở
   * laptop có iPhone bấm "Mở Terminal" và Terminal bật lên ở máy chủ.
   */
  it('nói trước Terminal sẽ mở trên máy nào', () => {
    renderWithProviders(
      <PreflightChecks
        checks={[{ name: 'Tunnel cho WebView (iOS 17+)', ok: false, fix: 'ios-tunnel', detail: 'Chưa chạy.' }]}
        target={{ platform: 'ios', device: 'IPHONE-1', host: { name: 'Laptop của Bình', remote: true } }}
      />,
    );
    expect(screen.getByText(/Terminal sẽ mở trên Laptop của Bình/)).toBeInTheDocument();
  });

  it('gửi kèm thiết bị, để máy chủ chọn đúng máy làm việc', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(http.post(STREAM_ROUTES.prereqFix, async ({ request }) => {
      sent = await request.json();
      return sse([['done', { ok: true }]]);
    }));
    renderWithProviders(
      <PreflightChecks checks={[APPIUM_DOWN]} target={{ platform: 'ios', device: 'IPHONE-1' }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Khởi động Appium' }));
    await waitFor(() => expect(sent).toEqual({ op: 'start_appium', platform: 'ios', device: 'IPHONE-1' }));
  });

  /**
   * Người dùng làm việc từ xa: không ai ngồi ở máy chủ để gõ mật khẩu. Máy
   * có dịch vụ tunnel thì nút chỉ khởi động lại nó — và nói là không cần
   * mật khẩu.
   */
  it('máy có dịch vụ tunnel: nút khởi động lại, không cần mật khẩu', () => {
    renderWithProviders(
      <PreflightChecks
        checks={[{ name: 'Tunnel cho WebView (iOS 17+)', ok: false, fix: 'ios-tunnel', detail: 'Chưa nhận máy.' }]}
        target={{ platform: 'ios', host: { name: 'Máy chủ (mac)', remote: false, tunnelService: true } }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Khởi động lại tunnel' })).toBeInTheDocument();
    expect(screen.getByText(/không cần mật khẩu/)).toBeInTheDocument();
  });

  it('máy chủ CHƯA có dịch vụ: nói thẳng là cần người ở máy chủ, và cách cài một lần', () => {
    renderWithProviders(
      <PreflightChecks
        checks={[{ name: 'Tunnel cho WebView (iOS 17+)', ok: false, fix: 'ios-tunnel', detail: 'Chưa chạy.' }]}
        target={{ platform: 'ios', host: { name: 'Máy chủ (mac)', remote: false } }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mở Terminal trên máy chủ' })).toBeInTheDocument();
    expect(screen.getByText(/install-ios-tunnel-service\.sh/)).toBeInTheDocument();
  });
});
