import { describe, expect, it } from 'vitest';
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
      expect(useJobStore.getState().jobs['preflight-appium']?.status).toBe('done'),
    );
  });

  it('nói ra lỗi khi khởi động hỏng, không im lặng', async () => {
    renderWithProviders(<PreflightChecks checks={[APPIUM_DOWN]} />);
    useJobStore.setState((state) => ({
      jobs: {
        ...state.jobs,
        'preflight-appium': {
          logs: [],
          run: null,
          status: 'error',
          error: 'Cổng 4723 đang bị chiếm.',
          dropped: 0,
          controller: null,
        },
      },
    }));
    expect(await screen.findByText('Cổng 4723 đang bị chiếm.')).toBeInTheDocument();
  });
});
