import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { PrereqCard } from '../PrereqCard';

/**
 * Preflight nói cái gì hỏng; khối này là chỗ chữa. Bản React đầu tiên chỉ có
 * nửa đầu, nên biết là thiếu Appium xong vẫn phải mở terminal — mà đã phải mở
 * terminal thì màn hình kia cũng chẳng giúp được gì.
 */
describe('PrereqCard', () => {
  it('không hiện gì khi chạy web', () => {
    renderWithProviders(<PrereqCard platform="web" />);
    expect(screen.queryByText('Yêu cầu trước khi chạy')).not.toBeInTheDocument();
  });

  it('android: có Appium, adb và driver uiautomator2, không có Xcode', async () => {
    renderWithProviders(<PrereqCard platform="android" />);
    expect(await screen.findByText('Appium chưa chạy')).toBeInTheDocument();
    expect(screen.getByText('adb devices -l')).toBeInTheDocument();
    expect(screen.getByText('appium driver install uiautomator2')).toBeInTheDocument();
    expect(screen.queryByText('xcodebuild -version')).not.toBeInTheDocument();
  });

  it('ios: có Xcode, danh sách máy iOS và driver xcuitest', async () => {
    renderWithProviders(<PrereqCard platform="ios" />);
    expect(await screen.findByText('xcodebuild -version')).toBeInTheDocument();
    expect(screen.getByText('xcrun xctrace list devices')).toBeInTheDocument();
    expect(screen.getByText('appium driver install xcuitest')).toBeInTheDocument();
    expect(screen.queryByText('adb devices -l')).not.toBeInTheDocument();
  });

  /**
   * Danh sách máy chỉ hỏi khi được bấm: `adb devices` khởi động daemon và mất
   * vài giây, không phải thứ nên chạy chỉ vì ai đó mở trang.
   */
  it('chỉ gọi adb khi bấm Kiểm tra', async () => {
    let calls = 0;
    server.use(
      http.get(ROUTES.prereqAdb, () => {
        calls += 1;
        return HttpResponse.json({ devices: [] });
      }),
    );
    renderWithProviders(<PrereqCard platform="android" />);
    await screen.findByText('adb devices -l');
    expect(calls).toBe(0);
    await userEvent.click(screen.getAllByRole('button', { name: '⟳ Kiểm tra' })[1]!);
    expect(await screen.findByText(/Chưa có máy nào/)).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('nói rõ lý do khi Xcode chưa dùng được', async () => {
    server.use(
      http.get(ROUTES.prereqXcode, () =>
        HttpResponse.json({
          ok: false,
          reason: 'Đang trỏ tới Command Line Tools, không phải Xcode đầy đủ.',
        }),
      ),
    );
    renderWithProviders(<PrereqCard platform="ios" />);
    await userEvent.click(screen.getAllByRole('button', { name: '⟳ Kiểm tra' })[1]!);
    expect(
      await screen.findByText(/Đang trỏ tới Command Line Tools/),
    ).toBeInTheDocument();
  });
});
