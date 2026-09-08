import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { useJobStore } from '@/stores/jobStore';
import { PrereqTools } from '../PrereqTools';

/**
 * Trước đây đây là một thẻ riêng đứng cạnh thẻ preflight, và cả hai cùng liệt
 * kê Appium, thiết bị, driver — bằng hai cách vẽ khác nhau, trong đó chỉ một
 * cái thật sự khoá nút chạy. Nay chỉ còn phần hành động; kết luận "chạy được
 * chưa" chỉ có đúng một chỗ nói.
 */
describe('PrereqTools', () => {
  it('không lặp lại kết luận của preflight', () => {
    renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.queryByText(/Đủ điều kiện chạy|Sẵn sàng chạy/)).not.toBeInTheDocument();
    expect(screen.queryByText('Đạt')).not.toBeInTheDocument();
  });

  it('cài đúng driver theo nền tảng', () => {
    const { unmount } = renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.getByRole('button', { name: 'Cài driver uiautomator2' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<PrereqTools platform="ios" />);
    expect(screen.getByRole('button', { name: 'Cài driver xcuitest' })).toBeInTheDocument();
  });

  it('chỉ hỏi Xcode trên iOS', () => {
    const { unmount } = renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.queryByRole('button', { name: 'Kiểm tra Xcode' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<PrereqTools platform="ios" />);
    expect(screen.getByRole('button', { name: 'Kiểm tra Xcode' })).toBeInTheDocument();
  });

  /**
   * Câu lệnh tương đương hiện ra để việc màn hình vừa làm là thứ kiểm chứng lại
   * được, chứ không phải một hộp đen bấm rồi tin.
   */
  it('hiện câu lệnh tương đương của mỗi hành động', () => {
    renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.getByText('appium driver install uiautomator2')).toBeInTheDocument();
  });

  it('nói rõ lý do khi Xcode chưa dùng được', async () => {
    server.use(
      http.get(ROUTES.prereqXcode, () =>
        HttpResponse.json({ ok: false, reason: 'Mới chỉ có Command Line Tools.' }),
      ),
    );
    renderWithProviders(<PrereqTools platform="ios" />);
    expect(await screen.findByText('Mới chỉ có Command Line Tools.')).toBeInTheDocument();
  });

  /**
   * Khởi động lại phải bấm được cả khi Appium đang chạy — đó chính là lúc cần
   * nó, một Appium còn sống nhưng đã treo phiên cũ.
   */
  it('luôn cho khởi động lại Appium', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PrereqTools platform="android" />);
    const button = screen.getByRole('button', { name: 'Khởi động lại Appium' });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(useJobStore.getState().jobs['prereq-appium-restart']).toBeDefined();
  });
});
