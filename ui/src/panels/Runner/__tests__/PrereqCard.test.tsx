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
   * Hỏi adb ngay khi mở, không chờ ai bấm.
   *
   * Trước đây thì chờ, vì `adb devices` khởi động daemon và mất vài giây. Lý do
   * đó không còn đúng ở đúng trang này: Local Runner đã tự gọi /api/preflight
   * khi mở, mà preflight chạy `adb devices` (core/preflight.ts:307) — daemon đã
   * khởi động xong trước khi khối này hỏi. Đổi lại, một hàng trống không trả
   * lời được câu hỏi duy nhất mà cả khối sinh ra để trả lời: đã đủ điều kiện chưa.
   */
  it('hỏi adb ngay khi mở, không chờ bấm', async () => {
    let calls = 0;
    server.use(
      http.get(ROUTES.prereqAdb, () => {
        calls += 1;
        return HttpResponse.json({ devices: [] });
      }),
    );
    renderWithProviders(<PrereqCard platform="android" />);
    expect(await screen.findByText(/Chưa có máy nào/)).toBeInTheDocument();
    expect(calls).toBeGreaterThan(0);
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

/**
 * Bản trước không cho biết đã đủ điều kiện hay chưa: tín hiệu duy nhất là câu
 * chữ nằm trong những hộp xám trông giống hệt nhau, dù nội dung là "đã cài
 * xong" hay "chưa có máy nào". Người đọc phải tự tổng hợp.
 */
describe('PrereqCard — trạng thái đọc được bằng mắt', () => {
  const appiumUp = () =>
    http.get(ROUTES.prereqAppiumStatus, () =>
      HttpResponse.json({ running: true, managed: true, url: 'http://127.0.0.1:4723' }),
    );
  const appiumDown = () =>
    http.get(ROUTES.prereqAppiumStatus, () =>
      HttpResponse.json({ running: false, managed: false, url: 'http://127.0.0.1:4723' }),
    );
  const oneDevice = () =>
    http.get(ROUTES.prereqAdb, () =>
      HttpResponse.json({ devices: [{ id: 'emulator-5554', state: 'device', kind: 'emulator' }] }),
    );
  const noDevice = () => http.get(ROUTES.prereqAdb, () => HttpResponse.json({ devices: [] }));

  it('nói "Đủ điều kiện chạy" khi mọi mục kiểm tra được đều đạt', async () => {
    server.use(appiumUp(), oneDevice());
    renderWithProviders(<PrereqCard platform="android" />);
    expect(await screen.findByText('Đủ điều kiện chạy')).toBeInTheDocument();
  });

  it('đếm đúng số mục chưa đạt', async () => {
    server.use(appiumDown(), noDevice());
    renderWithProviders(<PrereqCard platform="android" />);
    expect(await screen.findByText('Còn 2 mục chưa đạt')).toBeInTheDocument();
  });

  it('mỗi hàng tự nói đạt hay chưa đạt, không bắt đọc log để đoán', async () => {
    server.use(appiumUp(), noDevice());
    renderWithProviders(<PrereqCard platform="android" />);

    await screen.findByText('Còn 1 mục chưa đạt');
    expect(screen.getAllByText('Đạt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chưa đạt').length).toBeGreaterThan(0);
  });

  /**
   * Driver không có endpoint nào hỏi được "đã cài chưa". Vẽ một dấu tích không
   * có gì chống lưng thì tệ hơn là nói thẳng ra là chưa kiểm tra.
   */
  it('nói thẳng driver là chưa kiểm tra, và không tính nó vào kết luận', async () => {
    server.use(appiumUp(), oneDevice());
    renderWithProviders(<PrereqCard platform="android" />);
    expect(await screen.findByText('Đủ điều kiện chạy')).toBeInTheDocument();
    expect(screen.getByText('Chưa kiểm tra')).toBeInTheDocument();
  });
});
